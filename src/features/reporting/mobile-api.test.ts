import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "@/features/auth/email-otp-context";
import { createMobileAuthApi } from "@/features/auth/mobile-api";

const userId = "11111111-1111-4111-8111-111111111111";
const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const email = "student@wisc.edu";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.${encode("synthetic-signature")}`;

describe("移动举报 HTTP 契约（真实 SDK，模拟网络；SQL 权限另验）", () => {
  let onboarding: boolean;
  let rpcResult: unknown;
  let failed: boolean;
  let calls: { name: string; body: Record<string, unknown>; authorization: string | null }[];

  beforeEach(() => {
    onboarding = true; failed = false; calls = [];
    rpcResult = [{ result_status: "created", report_id: reportId, snapshot: "must not leak", reported_user_id: targetId }];
  });

  function api() {
    return createMobileAuthApi({ getCodec: () => createEmailOtpContextCodec("synthetic-context-secret-32-characters-minimum"),
      createClient(accessToken) {
        return createClient("https://synthetic.supabase.co", "synthetic-anon", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, fetch: async (input, init) => {
            const request = new Request(input, init);
            const name = new URL(request.url).pathname.split("/").at(-1)!;
            const body = request.method === "GET" ? {} : await request.json();
            calls.push({ name, body, authorization: request.headers.get("authorization") });
            if (name === "user") return Response.json({ user: { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
            if (name === "get_member_context") return Response.json([{ user_id: userId, home_school_id: "uw-madison", enabled_school_id: "uw-madison", current_school_id: "uw-madison", onboarding_complete: onboarding, reverification_required: false }]);
            if (name === "create_behavior_report") return failed ? Response.json({ message: "private evidence" }, { status: 500 }) : Response.json(rpcResult);
            throw new Error(`Unexpected synthetic request ${name}`);
          } },
        });
      },
    });
  }

  const valid = { targetType: "profile", targetId, reason: "spam", details: "  repeated ads  " };
  function request(body: unknown = valid, suffix = "", authorized = true, method = "POST") {
    return new Request(`https://app.test/api/mobile/v1/reports${suffix}`, { method,
      headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${token}` } : { cookie: "sb-access-token=synthetic" }) },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("要求 Bearer／资料准入，仅将目标与原因交给受控 RPC，成功响应不暴露证据", async () => {
    expect((await api()(request(valid, "", false))).status).toBe(401);
    expect(calls).toHaveLength(0);
    onboarding = false;
    expect((await api()(request())).status).toBe(403);
    expect(calls.some(call => call.name === "create_behavior_report")).toBe(false);
    onboarding = true;
    const response = await api()(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "created", reportId });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(calls.find(call => call.name === "create_behavior_report")).toEqual({ name: "create_behavior_report", authorization: `Bearer ${token}`,
      body: { target_type: "profile", target_id: targetId, report_reason: "spam", report_details: "repeated ads" } });
  });

  it("消息 ID 不丢精度，UUID 归一避免大小写重复，重复待处理返回原 ID", async () => {
    rpcResult = [{ result_status: "already_pending", report_id: reportId }];
    const response = await api()(request({ targetType: "message", targetId: "9007199254740993", reason: "harassment" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_pending", reportId });
    expect(calls.at(-1)!.body).toEqual({ target_type: "message", target_id: "9007199254740993", report_reason: "harassment", report_details: null });
    await api()(request({ ...valid, targetId: targetId.toUpperCase(), details: null }));
    expect(calls.at(-1)!.body.target_id).toBe(targetId);
  });

  it.each([
    [{ ...valid, reporterId: userId }, "invalid_request"],
    [{ ...valid, reportedUserId: targetId }, "invalid_request"],
    [{ ...valid, snapshot: { body: "forged" } }, "invalid_request"],
    [{ ...valid, schoolId: "umich" }, "invalid_request"],
    [{ ...valid, details: {} }, "invalid_request"],
    [{ ...valid, targetId: 42 }, "invalid_request"],
    [{ ...valid, targetType: "offline_dispute" }, "invalid_target"],
    [{ ...valid, targetId: "unknown" }, "invalid_target"],
    [{ ...valid, targetType: "message", targetId: "9223372036854775808" }, "invalid_target"],
    [{ ...valid, targetType: "message", targetId: "0" }, "invalid_target"],
    [{ ...valid, reason: "punish" }, "invalid_reason"],
    [{ ...valid, reason: "other", details: "  " }, "invalid_details"],
    [{ ...valid, details: "界".repeat(1001) }, "invalid_details"],
  ])("输入拒绝伪造及不合法目标／原因／说明：%j", async (input, status) => {
    const response = await api()(request(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status });
    expect(calls.some(call => call.name === "create_behavior_report")).toBe(false);
  });

  it.each([["invalid_target", 400], ["invalid_reason", 400], ["invalid_details", 400], ["self_report", 403], ["onboarding_required", 403], ["not_available", 404], ["unknown", 503]])("RPC %s 有明确反馈且不回传其他字段", async (status, http) => {
    rpcResult = [{ result_status: status, snapshot: "private evidence", reporter_id: userId }];
    const response = await api()(request());
    expect(response.status).toBe(http);
    expect(await response.json()).toEqual({ status: status === "unknown" ? "temporarily_unavailable" : status });
  });

  it("拒绝查询与错误方法，暂时错误不泄漏内部证据或冒充成功", async () => {
    expect((await api()(request(valid, "?actor=other"))).status).toBe(400);
    expect(calls.some(call => call.name === "create_behavior_report")).toBe(false);
    const get = await api()(request(valid, "", true, "GET"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    failed = true;
    const response = await api()(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
  });

  it("畸形成功记录必须失败，不能把无效 ID 或多行响应当已受理", async () => {
    for (const result of [[], [{ result_status: "created", report_id: "forged" }], [
      { result_status: "created", report_id: reportId }, { result_status: "created", report_id: targetId },
    ]]) {
      rpcResult = result;
      const response = await api()(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "temporarily_unavailable" });
    }
  });
});
