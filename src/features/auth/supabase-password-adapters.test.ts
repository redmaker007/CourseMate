import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabasePasswordSetup, createSupabasePasswordSignIn } from "./supabase-password-adapters";

const asClient = (value: unknown) => value as SupabaseClient;

function isolatedClient(options: {
  verifyError?: unknown;
  userId?: string;
  updateError?: unknown;
  failRpc?: string;
} = {}) {
  const calls: string[] = [];
  const client = asClient({
    auth: {
      verifyOtp: async () => {
        calls.push("verifyOtp");
        return { data: { user: { id: options.userId ?? "user-1" } }, error: options.verifyError ?? null };
      },
      updateUser: async () => {
        calls.push("updateUser");
        return { data: {}, error: options.updateError ?? null };
      },
      signOut: async (scope: unknown) => {
        calls.push(`signOut:${JSON.stringify(scope)}`);
        return { error: null };
      },
    },
    rpc: async (name: string) => {
      calls.push(name);
      return name === options.failRpc ? { data: null, error: { message: "synthetic" } } : { data: "recorded", error: null };
    },
  });
  return { client, calls };
}

const input = { email: "student@wisc.edu", code: "123456", password: "secret-123", expectedUserId: "user-1" };

describe("设置密码", () => {
  it("验码 → 登记验证 → 改密码 → 登记指纹，并保留验码得到的会话（改密码会撤销其他会话）", async () => {
    const { client, calls } = isolatedClient();
    await expect(createSupabasePasswordSetup(client).setPassword(input)).resolves.toEqual({ status: "password_set" });
    expect(calls).toEqual(["verifyOtp", "record_email_verification", "updateUser", "record_password_set"]);
  });

  it("验出的是别的账号时不改密码", async () => {
    const { client, calls } = isolatedClient({ userId: "someone-else" });
    await expect(createSupabasePasswordSetup(client).setPassword(input)).resolves.toEqual({ status: "unavailable" });
    expect(calls).not.toContain("updateUser");
    expect(calls.at(-1)).toBe('signOut:{"scope":"local"}');
  });

  it("验证码错误时不留会话，也不改密码", async () => {
    const { client, calls } = isolatedClient({ verifyError: { code: "otp_expired", status: 403 } });
    await expect(createSupabasePasswordSetup(client).setPassword(input)).resolves.toEqual({ status: "invalid_or_expired" });
    expect(calls).toEqual(["verifyOtp"]);
  });

  it("Auth 认为密码太弱时如实返回；新旧相同照样登记", async () => {
    const weak = isolatedClient({ updateError: { code: "weak_password", status: 422 } });
    await expect(createSupabasePasswordSetup(weak.client).setPassword(input)).resolves.toEqual({ status: "weak_password" });
    expect(weak.calls).not.toContain("record_password_set");

    const same = isolatedClient({ updateError: { code: "same_password", status: 422 } });
    await expect(createSupabasePasswordSetup(same.client).setPassword(input)).resolves.toEqual({ status: "password_set" });
  });

  it("登记失败时报暂时不可用", async () => {
    const { client } = isolatedClient({ failRpc: "record_password_set" });
    await expect(createSupabasePasswordSetup(client).setPassword(input)).resolves.toEqual({ status: "unavailable" });
  });
});

describe("密码登录适配", () => {
  it.each([
    [null, "signed_in"],
    [{ code: "invalid_credentials", status: 400 }, "invalid_credentials"],
    [{ code: "email_not_confirmed", status: 400 }, "invalid_credentials"],
    [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "unexpected_failure", status: 500 }, "unavailable"],
  ] as const)("Auth 结果 %j → %s", async (error, status) => {
    const adapter = createSupabasePasswordSignIn(asClient({ auth: { signInWithPassword: async () => ({ data: {}, error }) } }));
    await expect(adapter.signIn("student@wisc.edu", "secret-123")).resolves.toEqual({ status });
  });
});
