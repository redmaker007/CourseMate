import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  createSupabaseEmailOtpAuth,
  createSupabaseMemberSession,
  createSupabaseSchoolDirectory,
} from "./supabase-email-otp-adapters";

function asSupabaseClient(value: unknown) {
  return value as SupabaseClient;
}

describe("Supabase email OTP adapters", () => {
  it.each([
    [null, "accepted"],
    [{ code: "over_email_send_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "email_address_invalid", status: 400 }, "delivery_failed"],
    [{ code: "request_timeout", status: 504 }, "unavailable"],
  ] as const)("将 Supabase 发码结果映射为稳定结果", async (error, status) => {
    const adapter = createSupabaseEmailOtpAuth(
      asSupabaseClient({
        auth: {
          signInWithOtp: async () => ({ data: {}, error }),
        },
      }),
    );

    await expect(adapter.requestCode("student@wisc.edu")).resolves.toEqual({
      status,
    });
  });

  it.each([
    [null, "verified"],
    [{ code: "otp_expired", status: 403 }, "invalid_or_expired"],
    [{ code: "invalid_credentials", status: 400 }, "invalid_or_expired"],
    [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "request_timeout", status: 504 }, "unavailable"],
  ] as const)("将 Supabase 验证结果映射为稳定结果", async (error, status) => {
    let verificationInput: unknown;
    const adapter = createSupabaseEmailOtpAuth(
      asSupabaseClient({
        auth: {
          signInWithOtp: async () => ({ data: {}, error: null }),
          verifyOtp: async (input: unknown) => {
            verificationInput = input;
            return { data: {}, error };
          },
        },
      }),
    );

    await expect(
      adapter.verifyCode("Student@wisc.edu", "123456"),
    ).resolves.toEqual({ status });
    expect(verificationInput).toEqual({
      email: "Student@wisc.edu",
      token: "123456",
      type: "email",
    });
  });

  it("通过数据库唯一函数核对所选学校和精确域名", async () => {
    const adapter = createSupabaseSchoolDirectory(
      asSupabaseClient({
        rpc: async () => ({ data: "uw-madison", error: null }),
      }),
    );

    await expect(
      adapter.matchesEnabledSchool("uw-madison", "wisc.edu"),
    ).resolves.toBe(true);
    await expect(
      adapter.matchesEnabledSchool("umich", "wisc.edu"),
    ).resolves.toBe(false);
  });

  it("只有 Auth 邮箱域名与成员学校绑定一致时才是有效成员会话", async () => {
    const memberRow = {
      data: { user_id: "user-1", school_id: "uw-madison" },
      error: null,
    };
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => memberRow,
    };
    const adapter = createSupabaseMemberSession(
      asSupabaseClient({
        auth: {
          getUser: async () => ({
            data: { user: { id: "user-1", email: "Student@WISC.EDU" } },
            error: null,
          }),
        },
        from: () => query,
        rpc: async () => ({ data: "uw-madison", error: null }),
      }),
    );

    await expect(adapter.hasValidMemberSession()).resolves.toBe(true);
  });

  it("学校绑定与 Auth 邮箱域名不一致时不是有效成员会话", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: { user_id: "user-1", school_id: "umich" },
        error: null,
      }),
    };
    const adapter = createSupabaseMemberSession(
      asSupabaseClient({
        auth: {
          getUser: async () => ({
            data: { user: { id: "user-1", email: "student@wisc.edu" } },
            error: null,
          }),
        },
        from: () => query,
        rpc: async () => ({ data: "uw-madison", error: null }),
      }),
    );

    await expect(adapter.hasValidMemberSession()).resolves.toBe(false);
  });

  it("没有 Auth 会话时返回未登录", async () => {
    const adapter = createSupabaseMemberSession(
      asSupabaseClient({
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: { name: "AuthSessionMissingError" },
          }),
        },
      }),
    );

    await expect(adapter.hasValidMemberSession()).resolves.toBe(false);
  });
});
