import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "@/features/auth/email-otp-context";
import { createMobileAuthApi } from "@/features/auth/mobile-api";

const userId = "11111111-1111-4111-8111-111111111111";
const courseId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const email = "student@wisc.edu";
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.${encode("synthetic-signature")}`;
const course = { id: courseId, school_id: "uw-madison", code: "CS 400", code_normalized: "CS400", title: "Programming III", term: "2026-fall" };

describe("移动课程 HTTP 契约（真实 SDK，模拟网络）", () => {
  let onboarding: boolean;
  let joined: boolean;
  let archived: boolean;
  let failure: string | null;
  let courseSchool: string;
  let courseTerm: string;
  let catalog: typeof course[];
  let currentSchool: string;
  let dashboardCount: number;
  let calls: { path: string; method: string; body: Record<string, unknown>; authorization: string | null }[];

  beforeEach(() => {
    onboarding = true; joined = true; archived = false; failure = null;
    courseSchool = "uw-madison"; courseTerm = "2026-fall"; calls = [];
    catalog = [course];
    currentSchool = "uw-madison"; dashboardCount = 1;
  });

  function api() {
    return createMobileAuthApi({
      getCodec: () => createEmailOtpContextCodec("synthetic-context-secret-32-characters-minimum"),
      createClient(accessToken) {
        return createClient("https://synthetic.supabase.co", "synthetic-anon", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            fetch: async (input, init) => {
              const request = new Request(input, init);
              const url = new URL(request.url);
              const name = url.pathname.split("/").at(-1);
              const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
              calls.push({ path: url.pathname + url.search, method: request.method, body, authorization: request.headers.get("authorization") });
              const json = (data: unknown, status = 200) => Response.json(data, { status });
              if (name === "user") return json({ user: { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
              if (name === "get_member_context") return json([{ user_id: userId, home_school_id: "uw-madison", enabled_school_id: "uw-madison", current_school_id: currentSchool, onboarding_complete: onboarding, reverification_required: false }]);
              if (failure === "network") return json({ message: "synthetic failure" }, 503);
              if (name === "school_term_settings") return json([{ current_term: "2026-fall" }]);
              if (name === "get_dashboard_courses") {
                if (!joined || url.searchParams.get("archived") !== `eq.${archived}`) return json([]);
                const offset = Number(url.searchParams.get("offset") ?? 0);
                const limit = Number(url.searchParams.get("limit") ?? 50);
                return json(Array.from({ length: dashboardCount }, (_, index) => ({ course_id: courseId, school_id: currentSchool, code: `CS ${400 + index}`, title: "Programming III", term: courseTerm, conversation_id: conversationId, archived, member_count: 2 })).slice(offset, offset + limit));
              }
              if (name === "courses") {
                const requestedSchool = url.searchParams.get("school_id");
                const requestedTerm = url.searchParams.get("term");
                if ((requestedSchool && requestedSchool !== `eq.${courseSchool}`) || (requestedTerm && requestedTerm !== `eq.${courseTerm}`)) return json([]);
                const offset = Number(url.searchParams.get("offset") ?? 0);
                const limit = Number(url.searchParams.get("limit") ?? 500);
                return json(catalog.slice(offset, offset + limit).map(row => ({ ...row, school_id: courseSchool, term: courseTerm })));
              }
              if (name === "course_members") {
                if (request.method === "POST") {
                  if (failure === "duplicate" || joined) return json({ code: "23505", message: "synthetic duplicate" }, 409);
                  if (failure === "rls") return json({ code: "42501", message: "synthetic denial" }, 403);
                  joined = true; return new Response(null, { status: 201 });
                }
                if (request.method === "DELETE") { joined = false; return new Response(null, { status: 204 }); }
                return json(joined ? [{ course_id: courseId }] : []);
              }
              if (name === "course_conversations") return json(joined ? [{ conversation_id: conversationId }] : []);
              if (name === "conversations") return json(joined ? [{ archived_at: archived ? "2026-10-01T00:00:00Z" : null }] : []);
              throw new Error(`Unexpected synthetic request: ${name}`);
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

  it("课程接口必须使用 Bearer，完成资料后才返回本人的课程", async () => {
    const handler = api();
    expect((await handler(request("courses", undefined, null))).status).toBe(401);
    onboarding = false;
    expect(await (await handler(request("courses"))).json()).toEqual({ status: "onboarding_required" });
    onboarding = true;
    const response = await handler(request("courses"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", schoolId: "uw-madison", currentTerm: "2026-fall", courses: [{ id: courseId, conversationId, archived: false }], page: { offset: 0, limit: 50, nextOffset: null } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(calls.filter(call => call.path.includes("/rest/")).every(call => call.authorization === `Bearer ${token}`)).toBe(true);
  });

  it("搜索复用精确课号、前缀优先级并分页，只读取当前学校当前学期", async () => {
    catalog = [
      { ...course, id: "44444444-4444-4444-8444-444444444444", code: "CS 400B" },
      course,
      { ...course, id: "55555555-5555-4555-8555-555555555555", code: "CS 400A" },
    ];
    const response = await api()(request("courses/search?q=CS400&limit=1&offset=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", currentTerm: "2026-fall", courses: [{ code: "CS 400A", matchKind: "code_prefix", joined: false }], page: { limit: 1, offset: 1, nextOffset: 2 } });
    const catalogRequest = calls.find(call => call.path.includes("/courses?"));
    const params = new URL(`https://synthetic.example${catalogRequest!.path}`).searchParams;
    expect(params.get("school_id")).toBe("eq.uw-madison");
    expect(params.get("term")).toBe("eq.2026-fall");
    expect(params.get("order")).toBe("code_normalized.asc,id.asc");
  });

  it("未加入的本校当前课程可查看，加入后才取得会话，退出立即失去入口", async () => {
    joined = false;
    const handler = api();
    const before = await handler(request(`courses/${courseId}`));
    expect(await before.json()).toMatchObject({ status: "ok", course: { id: courseId, joined: false, conversationId: null, canJoin: true, canLeave: false } });
    expect(await (await handler(request(`courses/${courseId}/join`, {}))).json()).toEqual({ status: "joined" });
    const after = await handler(request(`courses/${courseId}`));
    expect(await after.json()).toMatchObject({ status: "ok", course: { joined: true, conversationId, canJoin: false, canLeave: true } });
    expect(await (await handler(request(`courses/${courseId}/leave`, {}))).json()).toEqual({ status: "left" });
    expect(await (await handler(request(`courses/${courseId}`))).json()).toMatchObject({ course: { joined: false, conversationId: null } });
    const insert = calls.find(call => call.method === "POST" && call.path.includes("/course_members"));
    expect(insert!.body).toEqual({ course_id: courseId });
    const deletion = calls.find(call => call.method === "DELETE");
    expect(new URL(`https://synthetic.example${deletion!.path}`).searchParams.get("user_id")).toBe(`eq.${userId}`);
  });

  it.each(["", "/join", "/leave"])("跨校课程 %s 不可访问且不写数据", async (action) => {
    courseSchool = "umich";
    const response = await api()(request(`courses/${courseId}${action}`, action ? {} : undefined));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not_available" });
    expect(calls.some(call => call.method === "DELETE" || (call.method === "POST" && call.path.includes("/course_members")))).toBe(false);
  });

  it("归档课只允许已加入成员读取，旧学期不能加入或退出", async () => {
    courseTerm = "2025-fall"; archived = true;
    const handler = api();
    expect(await (await handler(request(`courses/${courseId}`))).json()).toMatchObject({ course: { joined: true, archived: true, canJoin: false, canLeave: false, conversationId } });
    expect((await handler(request(`courses/${courseId}/join`, {}))).status).toBe(404);
    expect((await handler(request(`courses/${courseId}/leave`, {}))).status).toBe(404);
    archived = false;
    expect((await handler(request(`courses/${courseId}/leave`, {}))).status).toBe(404);
    joined = false;
    expect((await handler(request(`courses/${courseId}`))).status).toBe(404);
  });

  it("重复加入和写入被拒绝沿用既有失败语义，重复退出不可误报有权限", async () => {
    const handler = api();
    for (const error of ["duplicate", "rls"]) {
      failure = error;
      const response = await handler(request(`courses/${courseId}/join`, {}));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
    }
    failure = null; joined = false;
    expect((await handler(request(`courses/${courseId}/leave`, {}))).status).toBe(404);
  });

  it("同时加入同一课程沿用唯一键冲突结果，客户端可重新读取最终状态", async () => {
    joined = false;
    const handler = api();
    const responses = await Promise.all([
      handler(request(`courses/${courseId}/join`, {})),
      handler(request(`courses/${courseId}/join`, {})),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 503]);
    expect(await (await handler(request(`courses/${courseId}`))).json()).toMatchObject({ course: { joined: true, conversationId } });
  });

  it("列表按 scope 和稳定键分页，使用当前学校而非邮箱学校", async () => {
    currentSchool = "umich"; dashboardCount = 3;
    const handler = api();
    const first = await (await handler(request("courses?limit=2"))).json();
    expect(first).toMatchObject({ schoolId: "umich", page: { nextOffset: 2 }, courses: [{ code: "CS 400" }, { code: "CS 401" }] });
    expect((await (await handler(request("courses?limit=2&offset=2"))).json()).page.nextOffset).toBeNull();
    expect(calls.find(call => call.path.includes("/get_dashboard_courses"))!.body).toEqual({ target_school: "umich" });
    const rpcPath = calls.find(call => call.path.includes("/get_dashboard_courses"))!.path;
    expect(new URL(`https://synthetic.example${rpcPath}`).searchParams.get("order")).toBe("code.asc,course_id.asc");
    archived = true;
    expect((await (await handler(request("courses?scope=archived"))).json()).courses[0].archived).toBe(true);
    expect((await (await handler(request("courses"))).json()).courses).toEqual([]);
  });

  it.each(["courses?schoolId=umich", "courses?term=2025-fall", "courses?limit=0", "courses?limit=101", "courses?offset=-1", "courses?offset=1.5", "courses?limit=1&limit=2", "courses?scope=all", "courses/search?q=", `courses/search?q=${"x".repeat(121)}`, "courses/not-a-uuid"])("拒绝不支持或畸形请求 %s", async path => {
    const response = await api()(request(path));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_request" });
  });

  it("拒绝客户端指定用户和非空加课请求，错误方法返回 JSON 405", async () => {
    const handler = api();
    expect((await handler(request(`courses/${courseId}/join`, { userId }))).status).toBe(400);
    const wrongMethod = await handler(request("courses", {}, token, "PATCH"));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    failure = "network";
    expect(await (await handler(request("courses"))).json()).toEqual({ status: "temporarily_unavailable" });
  });
});
