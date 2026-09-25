import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseMemberSessionReader } from "./supabase-email-otp-adapters";

type Reply = { data: unknown; error: unknown };
type Claims = { sub?: unknown; email?: unknown };

function fakeSupabase({
  claims = { sub: "user-1", email: "student@wisc.edu" } as Claims | null,
  claimsError = null as unknown,
  rpc = { data: [], error: null } as Reply,
} = {}) {
  // 没有会话时 getClaims 返回 data: null、error: null，不是报错。
  const getClaims = vi.fn(async () => ({
    data: claims ? { claims } : null,
    error: claimsError,
  }));
  const getUser = vi.fn();
  const rpcCall = vi.fn(async () => rpc);
  // 故意没有 from：校验路径不允许再走单独的表查询。
  const client = {
    auth: { getClaims, getUser },
    rpc: rpcCall,
  } as unknown as SupabaseClient;
  return { client, getClaims, getUser, rpc: rpcCall };
}

const ROW = {
  user_id: "user-1",
  home_school_id: "uw-madison",
  enabled_school_id: "uw-madison",
  current_school_id: "uw-madison",
  onboarding_complete: true,
};

describe("createSupabaseMemberSessionReader", () => {
  it("本地验证令牌，再用 get_member_context 一次取回全部事实，只有一次网络往返", async () => {
    const { client, getClaims, getUser, rpc } = fakeSupabase({
      rpc: { data: [ROW], error: null },
    });

    const session = await createSupabaseMemberSessionReader(
      client,
    ).getMemberSession();

    expect(session).toEqual({ userId: "user-1", schoolId: "uw-madison" });
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_member_context", {
      candidate_domain: "wisc.edu",
    });
  });

  it("页面上下文同样只验证一次令牌、只调用一次数据库函数", async () => {
    const { client, getClaims, getUser, rpc } = fakeSupabase({
      rpc: { data: [ROW], error: null },
    });

    const context = await createSupabaseMemberSessionReader(
      client,
    ).getMemberContext();

    expect(context).toEqual({
      userId: "user-1",
      email: "student@wisc.edu",
      homeSchoolId: "uw-madison",
      currentSchoolId: "uw-madison",
      onboardingComplete: true,
    });
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("没有登录会话时不访问数据库", async () => {
    const { client, rpc } = fakeSupabase({ claims: null });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("会话缺失错误按未登录处理", async () => {
    const { client, rpc } = fakeSupabase({
      claims: null,
      claimsError: { name: "AuthSessionMissingError" },
    });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["没有邮箱", { sub: "user-1" }],
    ["邮箱为空", { sub: "user-1", email: "" }],
    ["邮箱不是字符串", { sub: "user-1", email: 42 }],
    ["没有用户标识", { email: "student@wisc.edu" }],
    ["用户标识不是字符串", { sub: 7, email: "student@wisc.edu" }],
  ])("令牌声明不完整（%s）时按未登录处理，且不访问数据库", async (_label, claims) => {
    const { client, rpc } = fakeSupabase({ claims });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("没有成员账号（零行）时按未登录处理", async () => {
    const { client } = fakeSupabase({ rpc: { data: [], error: null } });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
  });

  it("返回的行形状不对时不放行", async () => {
    const { client } = fakeSupabase({
      rpc: { data: [{ user_id: null, home_school_id: 3 }], error: null },
    });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
  });

  it("域名未开放（开放学校为空）时按未登录处理", async () => {
    const { client } = fakeSupabase({
      rpc: { data: [{ ...ROW, enabled_school_id: null }], error: null },
    });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
  });

  it("onboarding 字段缺失时按未完成处理，而不是默认完成", async () => {
    const row: Partial<typeof ROW> = { ...ROW };
    delete row.onboarding_complete;
    const { client } = fakeSupabase({ rpc: { data: [row], error: null } });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberContext(),
    ).toMatchObject({ onboardingComplete: false });
  });

  it("令牌无效、函数调用出错时向上抛出，由调用方 fail closed", async () => {
    const rpcFailure = fakeSupabase({
      rpc: { data: null, error: new Error("function not found") },
    });
    await expect(
      createSupabaseMemberSessionReader(rpcFailure.client).getMemberSession(),
    ).rejects.toThrow("function not found");

    const invalidToken = fakeSupabase({
      claims: null,
      claimsError: new Error("Invalid JWT signature"),
    });
    await expect(
      createSupabaseMemberSessionReader(invalidToken.client).getMemberSession(),
    ).rejects.toThrow("Invalid JWT signature");
    expect(invalidToken.rpc).not.toHaveBeenCalled();
  });
});
