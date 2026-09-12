import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { getUser: vi.fn() },
}));
const reader = vi.hoisted(() => ({ getMemberSession: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("./supabase-email-otp-adapters", () => ({
  createSupabaseMemberSessionReader: () => reader,
}));

import { getCurrentMember } from "./session";

function currentSchoolAnswers(response: { data: unknown; error: unknown }) {
  supabase.rpc.mockImplementation(async (name: string) =>
    name === "has_completed_onboarding" ? { data: true, error: null } : response,
  );
}

describe("getCurrentMember", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    reader.getMemberSession.mockResolvedValue({ userId: "admin-1", schoolId: "umich" });
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { email: "admin@umich.edu" } },
    });
  });

  it("正常使用：当前学校就是邮箱归属，不带 homeSchoolId", async () => {
    currentSchoolAnswers({ data: "umich", error: null });
    expect(await getCurrentMember()).toEqual({
      userId: "admin-1",
      schoolId: "umich",
      email: "admin@umich.edu",
      onboardingComplete: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("current_school_id");
  });

  it("跨校测试：业务学校取数据库给出的当前学校，同时保留邮箱归属", async () => {
    currentSchoolAnswers({ data: "uw-madison", error: null });
    expect(await getCurrentMember()).toEqual({
      userId: "admin-1",
      schoolId: "uw-madison",
      homeSchoolId: "umich",
      email: "admin@umich.edu",
      onboardingComplete: true,
    });
  });

  it("读不到当前学校时按未登录处理，与读不到 onboarding 状态一致", async () => {
    currentSchoolAnswers({ data: null, error: { message: "boom" } });
    expect(await getCurrentMember()).toBeNull();

    currentSchoolAnswers({ data: null, error: null });
    expect(await getCurrentMember()).toBeNull();
  });
});
