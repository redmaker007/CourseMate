import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "@/features/auth/email-otp-context";
import { createMobileAuthApi } from "@/features/auth/mobile-api";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
const otherId = "33333333-3333-4333-8333-333333333333";
const courseId = "44444444-4444-4444-8444-444444444444";
const clientId = "bcdefabc-bcde-4bcd-8bcd-bcdefabcdefa";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const email = "student@wisc.edu";
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.${encode("synthetic-signature")}`;
const message = (id: string) => ({ id, client_message_id: null, conversation_id: conversationId, sender_id: userId, body: `message ${id}`, created_at: "2026-10-25T00:00:00Z" });

describe("移动消息 HTTP 契约（真实 SDK，模拟网络；SQL 权限另行验证）", () => {
  let accessible: boolean;
  let onboarding: boolean;
  let kind: "direct" | "course";
  let sendStatus: "allowed" | "blocked" | "readonly";
  let archived: boolean;
  let cleared: string | null;
  let messages: ReturnType<typeof message>[];
  let sendFailure: string | null;
  let stored: { clientId: string; body: string } | null;
  let databaseFailure: boolean;
  let calls: { name: string; method: string; params: URLSearchParams; body: Record<string, unknown>; authorization: string | null }[];

  beforeEach(() => {
    accessible = true; onboarding = true; kind = "direct"; sendStatus = "allowed"; archived = false;
    cleared = null; messages = [message("8"), message("9"), message("9007199254740993")];
    sendFailure = null; stored = null; calls = [];
    databaseFailure = false;
  });

  function api(onDirectMessageSent?: (messageId: string, conversationId: string) => void) {
    return createMobileAuthApi({ getCodec: () => createEmailOtpContextCodec("synthetic-context-secret-32-characters-minimum"),
      ...(onDirectMessageSent ? { onDirectMessageSent } : {}),
      createClient(accessToken) {
        return createClient("https://synthetic.supabase.co", "synthetic-anon", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, fetch: async (input, init) => {
            const request = new Request(input, init); const url = new URL(request.url);
            const name = url.pathname.split("/").at(-1)!;
            const body = request.method === "GET" ? {} : await request.json();
            calls.push({ name, method: request.method, params: url.searchParams, body, authorization: request.headers.get("authorization") });
            if (name === "user") return Response.json({ user: { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
            if (name === "get_member_context") return Response.json([{ user_id: userId, home_school_id: "uw-madison", enabled_school_id: "uw-madison", current_school_id: "uw-madison", onboarding_complete: onboarding }]);
            if (databaseFailure) return Response.json({ message: "synthetic private failure" }, { status: 503 });
            if (name === "list_friends") return Response.json([{ member_id: otherId, display_name: "同学", effective_name: "搭子", conversation_id: conversationId, hidden: false }]);
            if (name === "get_dashboard_courses") return Response.json([{ course_id: courseId, conversation_id: conversationId, code: "CS 400", title: "Programming III", term: "2026-fall", archived: false }]);
            if (name === "list_direct_conversation_unread") return Response.json([{ conversation_id: conversationId, unread_count: "2" }]);
            if (name === "get_direct_unread_counts") return Response.json([{ visible_unread: "2", hidden_unread: "1" }]);
            if (name === "conversations") return Response.json(accessible ? [{ id: conversationId, kind, archived_at: archived ? "2026-10-25T00:00:00Z" : null }] : []);
            if (name === "get_direct_conversation_view") return Response.json([{ conversation_id: conversationId, other_member_id: otherId, other_display_name: "同学", hidden: false, send_status: sendStatus }]);
            if (name === "conversation_members") return Response.json([{ conversation_id: conversationId, last_read_message_id: null, cleared_through_message_id: cleared }]);
            if (name === "course_conversations") return Response.json([{ course_id: courseId }]);
            if (name === "messages") {
              let selected = messages.filter(row => cleared === null || BigInt(row.id) > BigInt(cleared));
              const idFilter = url.searchParams.get("id");
              if (idFilter?.startsWith("in.(")) { const ids = idFilter.slice(4,-1).split(","); selected = selected.filter(row => ids.includes(row.id)); }
              for (const filter of url.searchParams.getAll("id")) {
                if (filter.startsWith("eq.")) selected = selected.filter(row => row.id === filter.slice(3));
                if (filter.startsWith("gt.")) selected = selected.filter(row => BigInt(row.id) > BigInt(filter.slice(3)));
                if (filter.startsWith("lt.")) selected = selected.filter(row => BigInt(row.id) < BigInt(filter.slice(3)));
                if (filter.startsWith("lte.")) selected = selected.filter(row => BigInt(row.id) <= BigInt(filter.slice(4)));
              }
              selected.sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
              if (url.searchParams.get("order") === "id.desc") selected.reverse();
              return Response.json(selected.slice(0, Number(url.searchParams.get("limit") ?? 200)));
            }
            if (name === "profiles") return Response.json([{ id: userId, display_name: "本人" }]);
            if (name === "send_conversation_message") {
              let status = sendFailure ?? "sent";
              if (stored && (stored.clientId !== body.client_message_id || stored.body !== body.message_body)) status = "idempotency_conflict";
              if (status === "sent") stored = { clientId: String(body.client_message_id), body: String(body.message_body) };
              return Response.json([{ result_status: status, message_id: "9007199254740993", conversation_id: conversationId, sender_id: userId, sender_display_name: "本人", body: body.message_body, created_at: "2026-10-25T00:00:00Z" }]);
            }
            if (name === "clear_direct_conversation") { cleared = String(body.through_message_id); return Response.json("updated"); }
            if (name === "mark_direct_conversation_read") return Response.json("updated");
            throw new Error(`Unexpected synthetic request ${name}`);
          } },
        });
      },
    });
  }

  function request(path: string, body?: unknown, bearer: string | null = token) {
    return new Request(`https://app.example/api/mobile/v1/${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }

  it("会话列表要求 Bearer 与资料准入，分开课程、普通与屏蔽私聊，保留精确未读数", async () => {
    const handler = api();
    expect((await handler(request("conversations", undefined, null))).status).toBe(401);
    onboarding = false;
    expect((await handler(request("conversations"))).status).toBe(403);
    onboarding = true;
    const response = await handler(request("conversations?kind=direct"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "loaded", conversations: [{ conversationId, kind: "direct", hidden: false, unreadCount: "2" }] });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("读取受权会话状态和 bigint 精确消息；前后分页可交错并固定补拉上界", async () => {
    const handler = api();
    const state = await handler(request(`conversations/${conversationId}`));
    expect(await state.json()).toMatchObject({ status: "loaded", conversation: { conversationId, kind: "direct", sendStatus: "allowed", clearedThroughMessageId: null, latestMessageId: "9007199254740993" } });
    const recent = await (await handler(request(`conversations/${conversationId}/messages?limit=1`))).json();
    expect(recent).toMatchObject({ status: "loaded", messages: [{ id: "9007199254740993" }], page: { direction: "before", nextCursor: "9007199254740993" } });
    const older = await (await handler(request(`conversations/${conversationId}/messages?before=9007199254740993&limit=1`))).json();
    expect(older.messages.map((row: { id: string }) => row.id)).toEqual(["9"]);
    const newer = await (await handler(request(`conversations/${conversationId}/messages?after=8&limit=1`))).json();
    expect(newer).toMatchObject({ messages: [{ id: "9" }], page: { direction: "after", nextCursor: "9" } });
    const bounded = await (await handler(request(`conversations/${conversationId}/messages?after=0&through=9`))).json();
    expect(bounded.messages.map((row: { id: string }) => row.id)).toEqual(["8", "9"]);
    expect(calls.filter(call => call.name === "messages").every(call => call.params.get("select")?.includes("id::text"))).toBe(true);
    accessible = false;
    expect((await handler(request(`conversations/${conversationId}/messages`))).status).toBe(404);
  });

  it("发送统一走受控 RPC，同 UUID 同正文重试返回同一消息，冲突不得覆盖正文", async () => {
    const notify = vi.fn(); const handler = api(notify);
    const path = `conversations/${conversationId}/messages`;
    const first = await (await handler(request(path, { clientMessageId: clientId, body: "  hello  " }))).json();
    const repeated = await (await handler(request(path, { clientMessageId: clientId, body: "hello" }))).json();
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ status: "sent", message: { id: "9007199254740993", clientMessageId: clientId, conversationId, body: "hello" } });
    expect((await handler(request(path, { clientMessageId: clientId, body: "changed" }))).status).toBe(409);
    expect(calls.filter(call => call.name === "send_conversation_message").every(call => call.params.get("select")?.includes("message_id::text"))).toBe(true);
    expect(calls.some(call => call.name === "messages" && call.method === "POST")).toBe(false);
    expect(notify).toHaveBeenCalledWith("9007199254740993", conversationId);
    kind = "course"; stored = null; notify.mockClear();
    expect((await handler(request(path, { clientMessageId: clientId, body: "course" }))).status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
  });

  it("大写消息 UUID 归一后返回成功，重试复用回执并与补拉的数据库 UUID 一致", async () => {
    const notify = vi.fn(); const handler = api(notify);
    const firstResponse = await handler(request(`conversations/${conversationId.toUpperCase()}/messages`, { clientMessageId: clientId.toUpperCase(), body: "hello" }));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ status: "sent", message: { conversationId, clientMessageId: clientId } });
    const repeated = await handler(request(`conversations/${conversationId}/messages`, { clientMessageId: clientId, body: "hello" }));
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(first);
    expect(calls.filter(call => call.name === "send_conversation_message").every(call => call.body.target_conversation_id === conversationId && call.body.client_message_id === clientId)).toBe(true);
    expect(notify).toHaveBeenCalledWith("9007199254740993", conversationId);
    const reconcile = await handler(request(`conversations/${conversationId.toUpperCase()}/reconcile`, { messageIds: ["8"] }));
    expect(await reconcile.json()).toMatchObject({ conversationId });
  });

  it("清除仅调用本人的既有 RPC；重校验返回不可见 ID，不复活已清除或删除内容", async () => {
    const handler = api();
    expect((await handler(request(`conversations/${conversationId}/read`, { throughMessageId: "9" }))).status).toBe(200);
    expect((await handler(request(`conversations/${conversationId}/clear`, { throughMessageId: "9" }))).status).toBe(200);
    expect(calls.find(call => call.name === "clear_direct_conversation")!.body).toEqual({ target_conversation_id: conversationId, through_message_id: "9" });
    const revalidated = await (await handler(request(`conversations/${conversationId}/reconcile`, { messageIds: ["8", "9", "9007199254740993"] }))).json();
    expect(revalidated).toMatchObject({ status: "reconciled", removedMessageIds: ["8", "9"], messages: [{ id: "9007199254740993" }] });
    messages = [];
    expect(await (await handler(request(`conversations/${conversationId}/reconcile`, { messageIds: ["9007199254740993"] }))).json()).toMatchObject({ removedMessageIds: ["9007199254740993"], messages: [] });
    kind = "course";
    expect((await handler(request(`conversations/${conversationId}/clear`, { throughMessageId: "9" }))).status).toBe(403);
  });

  it("完整状态给出真正的发送限制，课程归档只读，未读汇总不混入正文", async () => {
    const handler = api();
    sendStatus = "blocked";
    expect(await (await handler(request(`conversations/${conversationId}`))).json()).toMatchObject({ conversation: { sendStatus: "blocked" } });
    sendStatus = "readonly";
    expect(await (await handler(request(`conversations/${conversationId}`))).json()).toMatchObject({ conversation: { sendStatus: "readonly" } });
    kind = "course"; archived = true;
    expect(await (await handler(request(`conversations/${conversationId}`))).json()).toMatchObject({ conversation: { kind: "course", courseId, archived: true, sendStatus: "readonly" } });
    expect(await (await handler(request("conversations/unread"))).json()).toEqual({ status: "loaded", counts: { visible: "2", hidden: "1" } });
    expect((await handler(request("conversations?kind=course&scope=archived"))).status).toBe(200);
    expect(calls.find(call => call.name === "get_dashboard_courses")!.body).toEqual({ target_school: "uw-madison" });
    expect((await handler(request("conversations?kind=direct&scope=hidden"))).status).toBe(200);
    expect(calls.filter(call => call.name === "list_friends").at(-1)!.body).toEqual({ include_hidden: true });
  });

  it.each([["not_allowed", 403], ["not_available", 404], ["onboarding_required", 403], ["idempotency_conflict", 409], ["unknown", 503]])("受控发送 %s 不误报成功", async (status, http) => {
    sendFailure = status; const notify = vi.fn();
    const response = await api(notify)(request(`conversations/${conversationId}/messages`, { clientMessageId: clientId, body: "hello" }));
    expect(response.status).toBe(http);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["messages?after=-1", "messages?before=0", "messages?after=8&before=9", "messages?after=9223372036854775808", "messages?after=1.5", "messages?after=1&after=2", "messages?limit=201", "messages?through=9", "messages?after=9&through=8", "messages?userId=other"])("拒绝错误消息窗口 %s", async suffix => {
    const response = await api()(request(`conversations/${conversationId}/${suffix}`));
    expect(response.status).toBe(400);
  });

  it("拒绝伪造发送者、数字游标和超量重校验，权限失效不返回整个缓存清空指令", async () => {
    const handler = api();
    for (const [action, body] of [
      ["messages", { clientMessageId: clientId, body: "hello", senderId: otherId }],
      ["messages", { clientMessageId: "bad", body: "hello" }],
      ["messages", { clientMessageId: clientId, body: "字".repeat(4001) }],
      ["clear", { throughMessageId: 9 }],
      ["read", { throughMessageId: "9223372036854775808" }],
      ["reconcile", { messageIds: ["8", "8"] }],
      ["reconcile", { messageIds: [8] }],
      ["reconcile", { messageIds: Array.from({ length: 201 }, (_, i) => String(i + 1)) }],
    ] as const) expect((await handler(request(`conversations/${conversationId}/${action}`, body))).status).toBe(400);
    expect(calls.some(call => ["send_conversation_message", "clear_direct_conversation", "mark_direct_conversation_read"].includes(call.name))).toBe(false);
    accessible = false;
    const denied = await handler(request(`conversations/${conversationId}/reconcile`, { messageIds: ["8"] }));
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ status: "not_available" });
  });

  it("暂时故障不返回移除缓存指令，附带推送失败不改变发送结果", async () => {
    const handler = api(); databaseFailure = true;
    const failed = await handler(request(`conversations/${conversationId}/reconcile`, { messageIds: ["8"] }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "temporarily_unavailable" });
    databaseFailure = false;
    const sent = await api(() => { throw new Error("synthetic push failure"); })(request(`conversations/${conversationId}/messages`, { clientMessageId: clientId, body: "hello" }));
    expect(sent.status).toBe(200);
  });

  it("已清除消息的幂等重试只确认已处理，不从发送回执重新泄露或恢复正文", async () => {
    const handler = api();
    const payload = { clientMessageId: clientId, body: "hello" };
    expect((await handler(request(`conversations/${conversationId}/messages`, payload))).status).toBe(200);
    await handler(request(`conversations/${conversationId}/clear`, { throughMessageId: "9007199254740993" }));
    const retry = await handler(request(`conversations/${conversationId}/messages`, payload));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ status: "sent_not_visible", messageId: "9007199254740993", clientMessageId: clientId, conversationId });
  });
});
