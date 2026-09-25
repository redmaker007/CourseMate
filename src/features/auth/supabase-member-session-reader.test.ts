import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseMemberSessionReader } from "./supabase-email-otp-adapters";

type Reply = { data: unknown; error: unknown };

function fakeSupabase({
  user = { id: "user-1", email: "student@wisc.edu" } as {
    id: string;
    email?: string;
  } | null,
  userError = null as { name: string } | null,
  rpc = { data: [], error: null } as Reply,
} = {}) {
  const getUser = vi.fn(async () => ({ data: { user }, error: userError }));
  const rpcCall = vi.fn(async () => rpc);
  // 故意没有 from：校验路径不允许再走单独的表查询。
  const client = { auth: { getUser }, rpc: rpcCall } as unknown as SupabaseClient;
  return { client, getUser, rpc: rpcCall };
}

const ROW = {
  user_id: "user-1",
  home_school_id: "uw-madison",
  enabled_school_id: "uw-madison",
  current_school_id: "uw-madison",
  onboarding_complete: true,
};

describe("createSupabaseMemberSessionReader", () => {
  it("用 get_member_context 一次取回全部事实，只发两次请求", async () => {
    const { client, getUser, rpc } = fakeSupabase({
      rpc: { data: [ROW], error: null },
    });

    const session = await createSupabaseMemberSessionReader(
      client,
    ).getMemberSession();

    expect(session).toEqual({ userId: "user-1", schoolId: "uw-madison" });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_member_context", {
      candidate_domain: "wisc.edu",
    });
  });

  it("页面上下文同样只发两次请求", async () => {
    const { client, getUser, rpc } = fakeSupabase({
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
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("没有登录会话时不访问数据库", async () => {
    const { client, rpc } = fakeSupabase({
      user: null,
      userError: { name: "AuthSessionMissingError" },
    });

    expect(
      await createSupabaseMemberSessionReader(client).getMemberSession(),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Auth 用户没有邮箱时按未登录处理", async () => {
    const { client, rpc } = fakeSupabase({ user: { id: "user-1" } });

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

  it("函数调用出错、Auth 异常时向上抛出，由调用方 fail closed", async () => {
    const rpcFailure = fakeSupabase({
      rpc: { data: null, error: new Error("function not found") },
    });
    await expect(
      createSupabaseMemberSessionReader(rpcFailure.client).getMemberSession(),
    ).rejects.toThrow("function not found");

    const authFailure = fakeSupabase({
      user: null,
      userError: new Error("auth unavailable") as unknown as { name: string },
    });
    await expect(
      createSupabaseMemberSessionReader(authFailure.client).getMemberSession(),
    ).rejects.toThrow("auth unavailable");
  });
});
