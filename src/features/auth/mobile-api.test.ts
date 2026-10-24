import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "./email-otp-context";
import { createMobileAuthApi } from "./mobile-api";

const userId = "11111111-1111-4111-8111-111111111111";
const schoolId = "uw-madison";
const email = "student@wisc.edu";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
// HS256 在真实 SDK 中退回 Auth 校验；签名校验另由现有真实 ES256 测试覆盖。
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.${encode("synthetic-signature")}`;
const user = { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const session = { access_token: token, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user };
const codec = createEmailOtpContextCodec("synthetic-context-secret-32-characters-minimum");

describe("移动认证 HTTP 契约（真实 Supabase SDK，模拟网络）", () => {
  let memberRows: unknown[];
  let memberFailure: boolean;
  let refreshFailure: string | null;
  let logoutFailure: boolean;
  let profileExists: boolean;
  let saved: Record<string, unknown> | null;
  let otpStatus: number;
  let calls: { path: string; method: string; authorization: string | null; body: Record<string, unknown> }[];

  beforeEach(() => {
    memberRows = [{ user_id: userId, home_school_id: schoolId, enabled_school_id: schoolId, current_school_id: schoolId, onboarding_complete: false }];
    memberFailure = false;
    refreshFailure = null;
    logoutFailure = false;
    profileExists = false;
    saved = null;
    otpStatus = 200;
    calls = [];
  });

  function api() {
    return createMobileAuthApi({
      createClient(accessToken?: string) {
        return createClient("https://synthetic.supabase.co", "synthetic-anon-key", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            fetch: async (input, init) => {
              const request = new Request(input, init);
              const url = new URL(request.url);
              const path = url.pathname;
              const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
              calls.push({ path: path + url.search, method: request.method, authorization: request.headers.get("authorization"), body });
              const json = (value: unknown, status = 200) => Response.json(value, { status });
              if (path.endsWith("/otp")) return otpStatus === 200 ? json({}) : json({ error_code: "over_email_send_rate_limit", msg: "synthetic failure" }, otpStatus);
              if (path.endsWith("/verify")) return json(session);
              if (path.endsWith("/token")) {
                if (refreshFailure) return json({ error_code: refreshFailure, msg: "synthetic failure" }, refreshFailure === "unexpected_failure" ? 503 : 400);
                return json(session);
              }
              if (path.endsWith("/user")) return json({ user });
              if (path.endsWith("/logout")) return logoutFailure ? json({ msg: "synthetic failure" }, 503) : new Response(null, { status: 204 });
              if (path.endsWith("/enabled_school_id_for_email_domain")) return json(body.candidate_domain === "wisc.edu" ? schoolId : null);
              if (path.endsWith("/get_member_context")) return memberFailure ? json({ message: "synthetic database failure" }, 503) : json(memberRows);
              if (path.endsWith("/get_own_profile")) return json(profileExists ? [{ id: userId, display_name: "同学", major: null, grad_year: null, avatar_url: null }] : []);
              if (path.endsWith("/schools")) return json([{ id: schoolId, name_en: "Test University", name_zh: "测试大学", school_email_domains: [{ domain: "wisc.edu" }] }]);
              if (path.endsWith("/profiles")) {
                if (request.method === "POST" && profileExists) return json({ code: "23505", message: "synthetic conflict" }, 409);
                saved = body;
                return new Response(null, { status: 201 });
              }
              throw new Error(`未预期的测试请求 ${path}`);
            },
          },
        });
      },
      getCodec: () => codec,
    });
  }

  function request(path: string, body?: unknown, accessToken?: string, method = body === undefined ? "GET" : "POST") {
    return new Request(`https://app.example/api/mobile/v1/${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("提供学校并为合格邮箱签发固定上下文，不依赖 Cookie", async () => {
    const handler = api();
    const schools = await handler(request("schools"));
    expect((await schools.json()).schools[0].emailDomains).toEqual(["wisc.edu"]);
    const response = await handler(request("auth/request-code", { schoolId, email }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("code_sent");
    expect(codec.read(body.context)).toEqual({ schoolId, email });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["student@gmail.com", "student@sub.wisc.edu", "bad"])('拒绝不合格邮箱 %s，且不发码', async (invalidEmail) => {
    const response = await api()(request("auth/request-code", { schoolId, email: invalidEmail }));
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("invalid_email");
    expect(calls.some((call) => call.path.endsWith("/otp"))).toBe(false);
  });

  it("验证后交付最小会话和可信成员，并允许未完善资料的成员进入 onboarding", async () => {
    const response = await api()(request("auth/verify-code", { context: codec.issue({ schoolId, email }), code: "123456" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("signed_in");
    expect(body.session.accessToken).toBe(token);
    expect(body.session.refreshToken).toBe("synthetic-refresh");
    expect(body.member).toMatchObject({ userId, homeSchoolId: schoolId, onboardingComplete: false });
    expect(body.session.user).toBeUndefined();
  });

  it("篡改上下文、格式错误验证码及附带学校邮箱均不能绕过绑定", async () => {
    const handler = api();
    for (const body of [
      { context: "tampered", code: "123456" },
      { context: codec.issue({ schoolId, email }, -1000), code: "123456" },
      { context: codec.issue({ schoolId, email }), code: "12345" },
      { context: codec.issue({ schoolId, email }), code: "123456", email: "other@wisc.edu" },
    ]) expect((await handler(request("auth/verify-code", body))).status).toBe(400);
    expect(calls.some((call) => call.path.endsWith("/verify"))).toBe(false);
  });

  it("发码限流返回可识别的 429，不暴露供应商详情", async () => {
    otpStatus = 429;
    const response = await api()(request("auth/request-code", { schoolId, email }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: "rate_limited" });
  });

  it("已有可信成员会话时不再发码，先退出才能切换账号", async () => {
    const response = await api()(request("auth/request-code", { schoolId, email }, token));
    expect(await response.json()).toEqual({ status: "already_signed_in" });
    expect(calls.some((call) => call.path.endsWith("/otp"))).toBe(false);
  });

  it("没有成员或跨账号绑定时不交付凭据，并撤销刚创建的会话", async () => {
    for (const rows of [[], [{ ...(memberRows[0] as object), user_id: schoolId }]]) {
      memberRows = rows;
      const response = await api()(request("auth/verify-code", { context: codec.issue({ schoolId, email }), code: "123456" }));
      expect(response.status).toBe(503);
      expect((await response.json()).session).toBeUndefined();
    }
    expect(calls.filter((call) => call.path === "/auth/v1/logout?scope=local")).toHaveLength(2);
  });

  it("Cookie 不能代替 Bearer，缺失及错误令牌不访问成员数据", async () => {
    const handler = api();
    const cookieOnly = request("session");
    cookieOnly.headers.set("cookie", "sb-session=synthetic");
    expect((await handler(cookieOnly)).status).toBe(401);
    expect((await handler(request("session", undefined, "bad-token"))).status).toBe(401);
    expect(calls.some((call) => call.path.endsWith("/get_member_context"))).toBe(false);
  });

  it("Bearer 只用于当前请求，可信上下文沿用学校与账号不变量", async () => {
    const handler = api();
    const response = await handler(request("session", undefined, token));
    expect(response.status).toBe(200);
    expect((await response.json()).member.userId).toBe(userId);
    expect(calls.find((call) => call.path.endsWith("/get_member_context"))?.authorization).toBe(`Bearer ${token}`);
    expect((await handler(request("session"))).status).toBe(401);
    memberRows = [{ ...(memberRows[0] as object), enabled_school_id: null }];
    expect((await handler(request("session", undefined, token))).status).toBe(403);
  });

  it("临时数据库失败或畸形结果返回 503，不误报身份失效", async () => {
    memberFailure = true;
    expect((await api()(request("session", undefined, token))).status).toBe(503);
    memberFailure = false;
    memberRows = [{ user_id: userId }];
    expect((await api()(request("session", undefined, token))).status).toBe(503);
  });

  it("刷新交付完整新凭据；已失效刷新凭据和暂时故障分开", async () => {
    const handler = api();
    const response = await handler(request("auth/refresh", { refreshToken: "synthetic-refresh" }, "expired-bearer"));
    expect((await response.json()).session.refreshToken).toBe("synthetic-refresh");
    expect(calls.some((call) => call.path.endsWith("/get_member_context"))).toBe(false);
    memberFailure = true;
    expect((await handler(request("auth/refresh", { refreshToken: "synthetic-refresh" }))).status).toBe(200);
    refreshFailure = "refresh_token_not_found";
    const invalid = await handler(request("auth/refresh", { refreshToken: "invalid" }));
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).status).toBe("session_invalid");
    refreshFailure = "unexpected_failure";
    expect((await handler(request("auth/refresh", { refreshToken: "synthetic-refresh" }))).status).toBe(503);
  });

  it.each(["session_expired", "validation_failed"])("服务端明确拒绝刷新凭据 %s 时要求重登", async (code) => {
    refreshFailure = code;
    const response = await api()(request("auth/refresh", { refreshToken: "synthetic-refresh" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "session_invalid" });
  });

  it("资料读写使用会话本人，复用验证并保留 insert 冲突后 update", async () => {
    const handler = api();
    expect((await (await handler(request("profile", undefined, token))).json()).profile).toBeNull();
    const invalid = await handler(request("profile", { displayName: "", major: "", gradYear: "" }, token, "PATCH"));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fieldErrors.displayName).toBeTruthy();
    const draft = { displayName: "同学", major: "", gradYear: "" };
    expect((await handler(request("profile", { ...draft, userId: schoolId }, token, "PATCH"))).status).toBe(400);
    expect((await handler(request("profile", draft, token, "PATCH"))).status).toBe(200);
    expect(saved).toMatchObject({ id: userId, display_name: "同学", major: null, grad_year: null });
    profileExists = true;
    expect((await handler(request("profile", draft, token, "PATCH"))).status).toBe(200);
    expect(calls.some((call) => call.method === "PATCH" && call.path.includes(`id=eq.${userId}`))).toBe(true);
  });

  it("退出仅撤销当前会话，远端失败可重试", async () => {
    const handler = api();
    const response = await handler(request("auth/sign-out", {}, token));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("signed_out");
    expect(calls.find((call) => call.path === "/auth/v1/logout?scope=local")?.authorization).toBe(`Bearer ${token}`);
    logoutFailure = true;
    expect((await handler(request("auth/sign-out", {}, token))).status).toBe(503);
  });

  it("拒绝错误方法、未知路径、非 JSON、坏 JSON 和过大请求", async () => {
    const handler = api();
    expect((await handler(request("unknown"))).status).toBe(404);
    expect((await handler(request("session", {}))).status).toBe(405);
    const plain = new Request("https://app.example/api/mobile/v1/auth/refresh", { method: "POST", body: "plain" });
    expect((await handler(plain)).status).toBe(415);
    const malformed = new Request(plain.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await handler(malformed)).status).toBe(400);
    expect((await handler(request("auth/refresh", { refreshToken: "x".repeat(17000) }))).status).toBe(413);
  });
});
