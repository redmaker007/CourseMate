import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({}));
const reader = vi.hoisted(() => ({ getMemberContext: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("./supabase-email-otp-adapters", () => ({
  createSupabaseMemberSessionReader: () => reader,
}));

import { getCurrentMember } from "./session";

const CONTEXT = {
  userId: "admin-1",
  email: "admin@umich.edu",
  homeSchoolId: "umich",
  currentSchoolId: "umich",
  onboardingComplete: true,
};

describe("getCurrentMember", () => {
  beforeEach(() => {
    reader.getMemberContext.mockReset();
  });

  it("正常使用：当前学校就是邮箱归属，不带 homeSchoolId", async () => {
    reader.getMemberContext.mockResolvedValue(CONTEXT);

    expect(await getCurrentMember()).toEqual({
      userId: "admin-1",
      schoolId: "umich",
      email: "admin@umich.edu",
      onboardingComplete: true,
    });
  });

  it("跨校测试：业务学校取数据库给出的当前学校，同时保留邮箱归属", async () => {
    reader.getMemberContext.mockResolvedValue({
      ...CONTEXT,
      currentSchoolId: "uw-madison",
    });

    expect(await getCurrentMember()).toEqual({
      userId: "admin-1",
      schoolId: "uw-madison",
      homeSchoolId: "umich",
      email: "admin@umich.edu",
      onboardingComplete: true,
    });
  });

  it("未完成 onboarding 的成员如实带上状态，由页面决定跳转", async () => {
    reader.getMemberContext.mockResolvedValue({
      ...CONTEXT,
      onboardingComplete: false,
    });

    expect(await getCurrentMember()).toMatchObject({ onboardingComplete: false });
  });

  it("没有有效会话（含读不到当前学校）时按未登录处理", async () => {
    reader.getMemberContext.mockResolvedValue(null);

    expect(await getCurrentMember()).toBeNull();
  });

  it("读取失败时按未登录处理（fail closed），不向页面抛错", async () => {
    reader.getMemberContext.mockRejectedValue(new Error("auth unavailable"));

    expect(await getCurrentMember()).toBeNull();
  });
});
