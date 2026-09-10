import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));

import { requireStaff } from "./queries";

const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

describe("requireStaff", () => {
  beforeEach(() => {
    auth.getCurrentMember.mockReset();
    supabase.rpc.mockReset();
    auth.getCurrentMember.mockResolvedValue(MEMBER);
  });

  it("未登录时去登录页，登录后回到管理页", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    await expect(requireStaff()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fadmin",
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("没填完资料时先去 onboarding", async () => {
    auth.getCurrentMember.mockResolvedValue({ ...MEMBER, onboardingComplete: false });
    await expect(requireStaff()).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding/profile",
    );
  });

  it("没有身份时显示 404，不暴露管理页的存在", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireStaff()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(supabase.rpc).toHaveBeenCalledWith("current_platform_role");
  });

  it("身份读取出错或读到认不出的值时，同样按没有身份处理", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requireStaff()).rejects.toThrow("NEXT_NOT_FOUND");

    supabase.rpc.mockRejectedValue(new Error("network"));
    await expect(requireStaff()).rejects.toThrow("NEXT_NOT_FOUND");

    supabase.rpc.mockResolvedValue({ data: "superuser", error: null });
    await expect(requireStaff()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("管理员与所有者放行，并带上身份", async () => {
    supabase.rpc.mockResolvedValue({ data: "admin", error: null });
    await expect(requireStaff()).resolves.toEqual({ member: MEMBER, role: "admin" });

    supabase.rpc.mockResolvedValue({ data: "owner", error: null });
    await expect(requireStaff()).resolves.toEqual({ member: MEMBER, role: "owner" });
  });
});
