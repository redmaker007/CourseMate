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
  let unbindFailure: boolean;
  let profileExists: boolean;
  let saved: Record<string, unknown> | null;
  let otpStatus: number;
  let calls: { path: string; method: string; authorization: string | null; body: Record<string, unknown> }[];

  beforeEach(() => {
    memberRows = [{ user_id: userId, home_school_id: schoolId, enabled_school_id: schoolId, current_school_id: schoolId, onboarding_complete: false, reverification_required: false }];
    memberFailure = false;
    refreshFailure = null;
    logoutFailure = false;
    unbindFailure = false;
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
              if (path.endsWith("/record_email_verification")) return json("recorded");
              if (path.endsWith("/record_password_set")) return json("recorded");
              if (path.endsWith("/own_password_status")) return json(true);
              if (path.endsWith("/token")) {
                if (refreshFailure) return json({ error_code: refreshFailure, msg: "synthetic failure" }, refreshFailure === "unexpected_failure" ? 503 : 400);
                return json(session);
              }
              if (path.endsWith("/user")) return json({ user });
              if (path.endsWith("/logout")) return logoutFailure ? json({ msg: "synthetic failure" }, 503) : new Response(null, { status: 204 });
              if (path.endsWith("/remove_mobile_push_device")) return unbindFailure ? json({ message: "synthetic failure" }, 503) : json("removed");
              if (path.endsWith("/register_mobile_push_device")) return json("registered");
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
      getPushEnvironment: () => "sandbox",
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

  it("设备注册只接受安装标识和原生 token，身份由 Bearer 产生；退出先解绑再撤销会话", async () => {
    memberRows = [{ ...(memberRows[0] as object), onboarding_complete: true }];
    const handler = api();
    const body = { installationId: "22222222-2222-4222-8222-222222222222", deviceToken: "AB".repeat(32) };
    const registered = await handler(request("push/device", body, token, "PUT"));
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({ status: "registered" });
    expect(calls.find(c => c.path.endsWith("/register_mobile_push_device"))).toMatchObject({ authorization: `Bearer ${token}`,
      body: { target_installation: body.installationId, target_token: body.deviceToken.toLowerCase(), target_environment: "sandbox" } });
    for (const extra of [{ recipientId: userId },{ environment: "production" },{ body: "secret" }]) {
      expect((await handler(request("push/device", { ...body, ...extra }, token, "PUT"))).status).toBe(400);
    }
    expect((await handler(request("push/device", body, undefined, "PUT"))).status).toBe(401);
    expect((await handler(request("push/device", { ...body, deviceToken: "bad" }, token, "PUT"))).status).toBe(400);
    expect((await handler(request("auth/sign-out", {}, token))).status).toBe(200);
    const unbind = calls.findIndex(c => c.path.endsWith("/remove_mobile_push_device"));
    expect(unbind).toBeGreaterThan(-1);
    expect(calls.findIndex(c => c.path.startsWith("/auth/v1/logout"))).toBeGreaterThan(unbind);
    calls = []; unbindFailure = true;
    expect((await handler(request("auth/sign-out", {}, token))).status).toBe(503);
    expect(calls.some(c => c.path.startsWith("/auth/v1/logout"))).toBe(false);
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
      expect(response.status).toBe(403);
      expect((await response.clone().json()).status).toBe("membership_denied");
      expect((await response.json()).session).toBeUndefined();
    }
    expect(calls.filter((call) => call.path === "/auth/v1/logout?scope=local")).toHaveLength(2);
  });

  it("首次验码后成员读取临时失败仍返回 503，并撤销临时会话而不交付凭据", async () => {
    memberFailure = true;
    const response = await api()(request("auth/verify-code", { context: codec.issue({ schoolId, email }), code: "123456" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
    expect(calls.some(call => call.path === "/auth/v1/logout?scope=local")).toBe(true);
  });

  it("首次验码后畸形成员响应属于临时故障，不能误锁为已确认成员无效", async () => {
    const malformedResponses = [null, {}, [{ user_id: userId, home_school_id: schoolId }], [null], [false], [0], [""], [[]]];
    for (const malformed of malformedResponses) {
      memberRows = malformed as unknown[];
      const response = await api()(request("auth/verify-code", { context: codec.issue({ schoolId, email }), code: "123456" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
    }
    expect(calls.filter(call => call.path === "/auth/v1/logout?scope=local")).toHaveLength(malformedResponses.length);
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

  describe("密码登录与设置密码（ADR-0011）", () => {
    beforeEach(() => {
      memberRows = [{ ...(memberRows[0] as object), onboarding_complete: true }];
    });

    it("邮箱和密码换取会话与可信成员，不带旧 Bearer", async () => {
      const response = await api()(request("auth/password-sign-in", { email, password: "secret-123" }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ status: "signed_in", member: { userId }, session: { refreshToken: "synthetic-refresh" } });
      const grant = calls.find((call) => call.path.startsWith("/auth/v1/token"));
      expect(grant?.path).toBe("/auth/v1/token?grant_type=password");
      expect(grant?.body).toMatchObject({ email, password: "secret-123" });
    });

    it("密码对了但需要重新验证时不交付凭据，撤销刚建的会话", async () => {
      memberRows = [{ ...(memberRows[0] as object), reverification_required: true }];
      const response = await api()(request("auth/password-sign-in", { email, password: "secret-123" }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: "reverification_required" });
      expect(calls.some((call) => call.path === "/auth/v1/logout?scope=local")).toBe(true);
    });

    it("已登录的会话超过 30 天时受保护接口返回 401 reverification_required，而不是成员失效", async () => {
      memberRows = [{ ...(memberRows[0] as object), reverification_required: true }];
      const response = await api()(request("session", undefined, token));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: "reverification_required" });
    });

    it("查询密码状态、发码到本人邮箱、验码后设置密码并交付新凭据", async () => {
      const handler = api();
      expect(await (await handler(request("account/password", undefined, token))).json()).toEqual({ status: "ok", passwordSet: true });

      const sent = await handler(request("account/password/request-code", {}, token));
      const sentBody = await sent.json();
      expect(sentBody).toMatchObject({ status: "code_sent", email, resendAfterSeconds: 60 });
      expect(codec.read(sentBody.context)).toEqual({ schoolId, email });
      expect(calls.find((call) => call.path.startsWith("/auth/v1/otp"))?.authorization).not.toBe(`Bearer ${token}`);

      calls = [];
      const set = await handler(request("account/password", { context: sentBody.context, code: "123456", password: "secret-123" }, token, "PUT"));
      expect(set.status).toBe(200);
      // Supabase 改密码会撤销其他会话，App 必须换成这里交付的新凭据。
      expect(await set.json()).toEqual({ status: "password_set", session: { accessToken: token, refreshToken: "synthetic-refresh", expiresAt: expect.any(Number), tokenType: "bearer" } });
      const order = calls.map((call) => call.path.replace(/\?.*/, "").split("/").at(-1));
      expect(order).toEqual(expect.arrayContaining(["verify", "record_email_verification", "user", "record_password_set"]));
      expect(order).not.toContain("logout");
      // 验码不带原 Bearer，新会话来自验证码。
      expect(calls.find((call) => call.path.startsWith("/auth/v1/verify"))?.authorization).not.toBe(`Bearer ${token}`);
      expect(calls.find((call) => call.method === "PUT" && call.path.startsWith("/auth/v1/user"))?.body).toMatchObject({ password: "secret-123" });
    });

    it("别人的验证码上下文、弱密码、未登录都被拒绝", async () => {
      const handler = api();
      const foreign = codec.issue({ schoolId, email: "other@wisc.edu" });
      expect(await (await handler(request("account/password", { context: foreign, code: "123456", password: "secret-123" }, token, "PUT"))).json()).toEqual({ status: "invalid_context" });
      const own = codec.issue({ schoolId, email });
      const weak = await handler(request("account/password", { context: own, code: "123456", password: "short" }, token, "PUT"));
      expect([weak.status, await weak.json()]).toEqual([400, { status: "weak_password" }]);
      expect((await handler(request("account/password", { context: own, code: "123456", password: "secret-123" }, undefined, "PUT"))).status).toBe(401);
      expect(calls.some((call) => call.path.startsWith("/auth/v1/verify"))).toBe(false);
    });
  });
});
