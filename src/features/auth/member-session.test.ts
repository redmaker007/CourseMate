import { describe, expect, it, vi } from "vitest";

import {
  createMemberSessionReader,
  type MemberFacts,
  type MemberSessionDataPort,
} from "./member-session";

const FACTS: MemberFacts = {
  userId: "user-1",
  homeSchoolId: "uw-madison",
  enabledSchoolId: "uw-madison",
  currentSchoolId: "uw-madison",
  onboardingComplete: true,
};

function reader(overrides: Partial<MemberSessionDataPort> = {}) {
  const data = {
    getVerifiedUser: vi.fn(async () => ({
      id: "user-1",
      email: "Student@WISC.EDU",
    })),
    getMemberFacts: vi.fn(async (): Promise<MemberFacts | null> => FACTS),
    ...overrides,
  };
  return { data, reader: createMemberSessionReader(data) };
}

describe("getMemberSession", () => {
  it("Supabase 用户与学校绑定一致时返回完整成员会话", async () => {
    const { reader: sessionReader } = reader();

    await expect(sessionReader.getMemberSession()).resolves.toEqual({
      userId: "user-1",
      schoolId: "uw-madison",
    });
  });

  it("一次校验只向数据库读取一次，域名统一为小写", async () => {
    const { data, reader: sessionReader } = reader();

    await sessionReader.getMemberSession();

    expect(data.getVerifiedUser).toHaveBeenCalledTimes(1);
    expect(data.getMemberFacts).toHaveBeenCalledTimes(1);
    expect(data.getMemberFacts).toHaveBeenCalledWith("wisc.edu");
  });

  it("只有 Supabase 会话但没有 Member Account 时返回未登录", async () => {
    const { reader: sessionReader } = reader({
      getVerifiedUser: async () => ({
        id: "auth-only-user",
        email: "student@wisc.edu",
      }),
      getMemberFacts: async () => null,
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
  });

  it("Supabase 会话失效时返回未登录且不读取数据库", async () => {
    const { data, reader: sessionReader } = reader({
      getVerifiedUser: async () => null,
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
    expect(data.getMemberFacts).not.toHaveBeenCalled();
  });

  it("邮箱学校与 Member Account 绑定不一致时返回未登录", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, homeSchoolId: "other-school" }),
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
  });

  it("邮箱域名没有对应的开放学校时返回未登录", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, enabledSchoolId: null }),
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
  });

  it("数据库返回的成员账号不属于当前 Auth 用户时返回未登录", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, userId: "someone-else" }),
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
  });

  it.each(["@wisc.edu", "a@b@wisc.edu", "no-at-sign"])(
    "邮箱格式异常（%s）时返回未登录，且不读取数据库",
    async (email) => {
      const { data, reader: sessionReader } = reader({
        getVerifiedUser: async () => ({ id: "user-1", email }),
      });

      await expect(sessionReader.getMemberSession()).resolves.toBeNull();
      expect(data.getMemberFacts).not.toHaveBeenCalled();
    },
  );

  it("邮箱没有域名部分时交给数据库判断，域名不对应任何开放学校即未登录", async () => {
    const getMemberFacts = vi.fn(async () => ({ ...FACTS, enabledSchoolId: null }));
    const { reader: sessionReader } = reader({
      getVerifiedUser: async () => ({ id: "user-1", email: "student@" }),
      getMemberFacts,
    });

    await expect(sessionReader.getMemberSession()).resolves.toBeNull();
    expect(getMemberFacts).toHaveBeenCalledWith("");
  });

  it("读取失败时向上抛出，由调用方按未登录处理", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => {
        throw new Error("database unavailable");
      },
    });

    await expect(sessionReader.getMemberSession()).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("getMemberContext", () => {
  it("在有效会话之上带上邮箱、当前学校与 onboarding 状态", async () => {
    const { reader: sessionReader } = reader();

    await expect(sessionReader.getMemberContext()).resolves.toEqual({
      userId: "user-1",
      email: "Student@WISC.EDU",
      homeSchoolId: "uw-madison",
      currentSchoolId: "uw-madison",
      onboardingComplete: true,
    });
  });

  it("页面同样只读取一次数据库，不再重复验证用户", async () => {
    const { data, reader: sessionReader } = reader();

    await sessionReader.getMemberContext();

    expect(data.getVerifiedUser).toHaveBeenCalledTimes(1);
    expect(data.getMemberFacts).toHaveBeenCalledTimes(1);
  });

  it("跨校测试时当前学校与邮箱归属不同", async () => {
    const { reader: sessionReader } = reader({
      getVerifiedUser: async () => ({ id: "user-1", email: "admin@umich.edu" }),
      getMemberFacts: async () => ({
        ...FACTS,
        homeSchoolId: "umich",
        enabledSchoolId: "umich",
        currentSchoolId: "uw-madison",
      }),
    });

    await expect(sessionReader.getMemberContext()).resolves.toMatchObject({
      homeSchoolId: "umich",
      currentSchoolId: "uw-madison",
    });
  });

  it("没完成 onboarding 的成员仍是有效会话，只是状态为 false", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, onboardingComplete: false }),
    });

    await expect(sessionReader.getMemberContext()).resolves.toMatchObject({
      onboardingComplete: false,
    });
  });

  it("读不到当前学校时按未登录处理", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, currentSchoolId: null }),
    });

    await expect(sessionReader.getMemberContext()).resolves.toBeNull();
  });

  it("会话无效时不返回上下文", async () => {
    const { reader: sessionReader } = reader({
      getMemberFacts: async () => ({ ...FACTS, enabledSchoolId: "other-school" }),
    });

    await expect(sessionReader.getMemberContext()).resolves.toBeNull();
  });
});
