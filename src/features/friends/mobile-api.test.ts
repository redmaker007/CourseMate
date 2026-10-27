import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "@/features/auth/email-otp-context";
import { createMobileAuthApi } from "@/features/auth/mobile-api";

const userId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const email = "actor@wisc.edu";
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.${encode("synthetic-signature")}`;
const friend = { member_id: memberId, display_name: "同学", effective_name: "备注", avatar_url: null, major: null, grad_year: null, shared_courses: [{ id: "55555555-5555-4555-8555-555555555555", code: "CS 400", title: "Programming III" }], hidden: false, send_status: "allowed", block_status: "none", conversation_id: conversationId };

describe("移动好友 HTTP 契约（真实 SDK，模拟网络）", () => {
  let onboarding: boolean;
  let listRows: unknown;
  let mutation: unknown;
  let discovery: unknown;
  let failure: boolean;
  let calls: { name: string; params: URLSearchParams; body: Record<string, unknown>; authorization: string | null }[];

  beforeEach(() => {
    onboarding = true; listRows = [friend]; failure = false;
    mutation = [{ result_status: "sent", request_id: requestId }];
    discovery = [{ result_status: "found", ...friend, relationship_status: "none", incoming_request_id: null }];
    calls = [];
  });

  function api(onFriendRequestSent?: (id: string) => void) {
    return createMobileAuthApi({
      getCodec: () => createEmailOtpContextCodec("synthetic-context-secret-32-characters-minimum"),
      ...(onFriendRequestSent ? { onFriendRequestSent } : {}),
      createClient(accessToken) {
        return createClient("https://synthetic.supabase.co", "synthetic-anon", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            fetch: async (input, init) => {
              const request = new Request(input, init);
              const url = new URL(request.url);
              const name = url.pathname.split("/").at(-1)!;
              const body = request.method === "GET" ? {} : await request.json();
              calls.push({ name, params: url.searchParams, body, authorization: request.headers.get("authorization") });
              if (name === "user") return Response.json({ user: { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
              if (name === "get_member_context") return Response.json([{ user_id: userId, home_school_id: "uw-madison", enabled_school_id: "uw-madison", current_school_id: "uw-madison", onboarding_complete: onboarding }]);
              if (failure) return Response.json({ message: "synthetic private failure" }, { status: 503 });
              if (name === "find_member_by_email") return Response.json(discovery);
              if (name.startsWith("list_")) return Response.json(listRows);
              return Response.json(mutation);
            },
          },
        });
      },
    });
  }

  function request(path: string, body?: unknown, bearer: string | null = token, method = body === undefined ? "GET" : "POST") {
    return new Request(`https://app.example/api/mobile/v1/${path}`, { method,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("好友列表要求 Bearer 和资料准入，保留共同课程及单向屏蔽状态", async () => {
    const handler = api();
    expect((await handler(request("friends", undefined, null))).status).toBe(401);
    onboarding = false;
    expect((await handler(request("friends"))).status).toBe(403);
    expect(calls.some(call => call.name === "list_friends")).toBe(false);
    onboarding = true;
    const response = await handler(request("friends?limit=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "loaded", schoolId: "uw-madison", friends: [{ memberId, effectiveName: "备注", hidden: false, sharedCourses: [{ code: "CS 400" }], conversationId }], page: { limit: 1, offset: 0, nextOffset: null } });
    const call = calls.find(call => call.name === "list_friends")!;
    expect(call.body).toEqual({ include_hidden: false });
    expect(call.authorization).toBe(`Bearer ${token}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("找人邮箱只在 POST 中规范化，不返回邮箱；申请成功才安排已有网页推送", async () => {
    const notify = vi.fn();
    const handler = api(notify);
    const found = await handler(request("friends/search", { email: "  TARGET@WISC.EDU  " }));
    expect(found.status).toBe(200);
    const foundBody = await found.json();
    expect(foundBody).toMatchObject({ status: "found", member: { memberId, relationship: "none", incomingRequestId: null } });
    expect(JSON.stringify(foundBody)).not.toContain("wisc.edu");
    const lookup = calls.find(call => call.name === "find_member_by_email")!;
    expect(lookup.body).toEqual({ candidate_email: "target@wisc.edu" });
    expect(lookup.params.toString()).not.toContain("wisc");
    const sent = await handler(request("friend-requests", { memberId, message: "  一起学习  " }));
    expect(await sent.json()).toEqual({ status: "sent", requestId });
    expect(notify).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(calls.find(call => call.name === "send_friend_request")!.body).toEqual({ target_member_id: memberId, request_message: "一起学习" });
    mutation = [{ result_status: "already_pending", request_id: requestId }];
    const repeated = await handler(request("friend-requests", { memberId, message: "一起学习" }));
    expect(repeated.status).toBe(409);
    expect((await repeated.json()).status).toBe("already_pending");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("接受申请取得会话，非收件人拒绝；备注、屏蔽和拉黑分别传入自己的操作", async () => {
    const handler = api();
    mutation = [{ result_status: "accepted", conversation_id: conversationId }];
    expect(await (await handler(request(`friend-requests/${requestId}/respond`, { decision: "accept" }))).json()).toEqual({ status: "accepted", conversationId });
    expect(calls.find(call => call.name === "respond_to_friend_request")!.body).toEqual({ target_request_id: requestId, decision: "accept" });
    mutation = [{ result_status: "not_recipient" }];
    expect((await handler(request(`friend-requests/${requestId}/respond`, { decision: "reject" }))).status).toBe(403);
    mutation = "saved";
    for (const [action, body, rpc, args] of [
      ["note", { note: "  搭子  " }, "set_friend_note", { target_member_id: memberId, requested_note: "搭子" }],
      ["hide", { hidden: true }, "set_friend_hidden", { target_member_id: memberId, requested_hidden: true }],
      ["block", { blocked: true }, "set_member_blocked", { target_member_id: memberId, requested_blocked: true }],
    ] as const) {
      expect(await (await handler(request(`friends/${memberId}/${action}`, body))).json()).toEqual({ status: "saved" });
      expect(calls.find(call => call.name === rpc)!.body).toEqual(args);
    }
    mutation = "cleared";
    expect((await handler(request(`friends/${memberId}/note`, { note: "" }))).status).toBe(200);
    expect(calls.filter(call => call.name === "set_friend_note").at(-1)!.body.requested_note).toBeNull();
    expect((await handler(request(`friends/${memberId}/block`, { blocked: false }))).status).toBe(200);
    mutation = "removed";
    expect(await (await handler(request(`friends/${memberId}/remove`, {}))).json()).toEqual({ status: "removed" });
  });

  it("屏蔽专门列表、申请与主动拉黑列表在数据库过滤后分页，详情可读取本人屏蔽的好友", async () => {
    const handler = api();
    listRows = [{ ...friend, hidden: true }, { ...friend, hidden: true, member_id: "66666666-6666-4666-8666-666666666666" }];
    const hidden = await handler(request("friends?scope=hidden&limit=1"));
    expect(await hidden.json()).toMatchObject({ friends: [{ hidden: true }], page: { nextOffset: 1 } });
    const hiddenCall = calls.find(call => call.name === "list_friends")!;
    expect(hiddenCall.body).toEqual({ include_hidden: true });
    expect(hiddenCall.params.get("hidden")).toBe("eq.true");
    expect(hiddenCall.params.get("limit")).toBe("2");
    listRows = [{ ...friend, hidden: true }];
    expect(await (await handler(request(`friends/${memberId}`))).json()).toMatchObject({ status: "found", friend: { memberId, hidden: true } });
    listRows = [{ request_id: requestId, direction: "incoming", other_member_id: memberId, display_name: "同学", avatar_url: null, message: "一起学习", status: "pending", created_at: "2026-10-25T00:00:00Z", expires_at: "2026-11-01T00:00:00Z", resolved_at: null }];
    const requests = await handler(request("friend-requests?direction=incoming&status=pending"));
    expect(await requests.json()).toMatchObject({ status: "loaded", requests: [{ requestId, direction: "incoming", status: "pending" }] });
    const query = calls.find(call => call.name === "list_friend_requests")!.params;
    expect(query.get("direction")).toBe("eq.incoming");
    expect(query.get("status")).toBe("eq.pending");
    expect(query.get("order")).toBe("created_at.desc,request_id.desc");
    listRows = [{ ...friend, active_friendship: false }];
    expect(await (await handler(request("friends/blocked"))).json()).toMatchObject({ members: [{ memberId, activeFriendship: false }] });
    listRows = [];
    expect((await handler(request(`friends/${memberId}`))).status).toBe(404);
  });

  it.each([
    ["blocked", 403], ["already_friends", 409], ["incoming_request", 409], ["rate_limited", 429], ["not_available", 404], ["unknown_private_status", 503],
  ])("发送申请的 %s 保留真实失败含义", async (status, http) => {
    mutation = [{ result_status: status }];
    const notify = vi.fn();
    const response = await api(notify)(request("friend-requests", { memberId, message: "一起学习" }));
    expect(response.status).toBe(http);
    expect((await response.json()).status).toBe(http === 503 ? "temporarily_unavailable" : status);
    expect(notify).not.toHaveBeenCalled();
  });

  it("申请过期返回冲突；重复响应按实际状态返回，不能一律宣称用户刚才操作成功", async () => {
    const handler = api();
    mutation = [{ result_status: "expired" }];
    expect((await handler(request(`friend-requests/${requestId}/respond`, { decision: "accept" }))).status).toBe(409);
    mutation = [{ result_status: "accepted", conversation_id: conversationId }];
    expect(await (await handler(request(`friend-requests/${requestId}/respond`, { decision: "reject" }))).json()).toEqual({ status: "accepted", conversationId });
    mutation = "cleared";
    expect((await handler(request(`friends/${memberId}/block`, { blocked: false }))).status).toBe(200);
    listRows = [{ ...friend, block_status: "blocked_by_other", send_status: "blocked" }];
    expect(await (await handler(request("friends"))).json()).toMatchObject({ friends: [{ blockStatus: "blocked_by_other", sendStatus: "blocked" }] });
  });

  it("畸形成功结果、未知状态和服务故障不能误报成功，推送附带故障不改变已发出结果", async () => {
    const handler = api();
    mutation = [{ result_status: "sent" }];
    expect((await handler(request("friend-requests", { memberId, message: "一起学习" }))).status).toBe(503);
    mutation = [{ result_status: "accepted" }];
    expect((await handler(request(`friend-requests/${requestId}/respond`, { decision: "accept" }))).status).toBe(503);
    discovery = [{ result_status: "found", ...friend, member_id: null, relationship_status: "none" }];
    expect((await handler(request("friends/search", { email: "target@wisc.edu" }))).status).toBe(503);
    listRows = null;
    expect((await handler(request("friends"))).status).toBe(503);
    mutation = [{ result_status: "sent", request_id: requestId }];
    expect((await api(() => { throw new Error("synthetic push failure"); })(request("friend-requests", { memberId, message: "一起学习" }))).status).toBe(200);
    failure = true;
    const response = await handler(request("friends"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
  });

  it.each(["friends?userId=other", "friends?schoolId=umich", "friends?scope=all", "friends?limit=101", "friends?limit=1&limit=2", "friends?offset=-1", "friend-requests?direction=other", "friend-requests?status=deleted", "friends/blocked?scope=all", "friends/not-a-uuid"])("拒绝越界查询 %s", async path => {
    const response = await api()(request(path));
    expect(response.status).toBe(400);
    expect(calls.some(call => call.name.startsWith("list_"))).toBe(false);
  });

  it("拒绝伪造身份、字符串布尔值、非法决定和超长文本，验证失败不调用写入 RPC", async () => {
    const handler = api();
    for (const [path, body] of [
      [`friends/${memberId}/hide`, { hidden: "false" }],
      [`friends/${memberId}/block`, { blocked: true, userId }],
      [`friends/${memberId}/note`, { note: "字".repeat(16) }],
      [`friends/${memberId}/remove`, { userId }],
      [`friend-requests/${requestId}/respond`, { decision: "delete" }],
      ["friend-requests", { memberId, message: "字".repeat(301) }],
      ["friend-requests", { memberId, message: " " }],
      ["friends/search", { email: "bad" }],
      ["friends/search?email=target", { email: "target@wisc.edu" }],
    ] as const) expect((await handler(request(path, body))).status).toBe(400);
    expect(calls.every(call => ["user", "get_member_context"].includes(call.name))).toBe(true);
    expect((await handler(request("friends/search"))).status).toBe(405);
    discovery = [{ result_status: "not_found" }];
    expect((await handler(request("friends/search", { email: "other@umich.edu" }))).status).toBe(404);
    discovery = [{ result_status: "rate_limited" }];
    expect((await handler(request("friends/search", { email: "target@wisc.edu" }))).status).toBe(429);
  });
});
