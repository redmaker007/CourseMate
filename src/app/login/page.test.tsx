import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/auth/queries", () => ({ getEnabledSchools: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({
  requestEmailCodeAction: vi.fn(),
  verifyEmailCodeAction: vi.fn(),
}));

import LoginPage from "./page";

describe("Login page flow", () => {
  beforeEach(() => {
    auth.getCurrentMember.mockReset();
    navigation.redirect.mockClear();
  });

  it("已登录但未完成资料时进入强制 onboarding，并保留站内目标", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: false,
    });

    await expect(
      LoginPage({
        searchParams: Promise.resolve({ next: "/friends?tab=requests" }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding/profile?next=%2Ffriends%3Ftab%3Drequests",
    );
  });

  it("已完成资料的成员不能被反斜杠地址带到站外", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: true,
    });

    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "/\\evil.example" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});
