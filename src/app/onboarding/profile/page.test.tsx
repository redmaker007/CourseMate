// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const profiles = vi.hoisted(() => ({ getOwnProfile: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/profile/queries", () => profiles);
vi.mock("@/features/profile/actions", () => ({
  completeProfileOnboardingAction: vi.fn(),
}));
vi.mock("@/features/dashboard/actions", () => ({
  signOutAndReturnToLoginAction: vi.fn(),
}));
vi.mock("@/features/profile/components/profile-form", () => ({
  ProfileForm: ({ initialProfile }: { initialProfile: { displayName: string } }) => (
    <div data-testid="profile-form">{initialProfile.displayName}</div>
  ),
}));

import ProfileOnboardingPage from "./page";

afterEach(cleanup);

describe("Profile onboarding page flow", () => {
  beforeEach(() => {
    auth.getCurrentMember.mockReset();
    profiles.getOwnProfile.mockReset();
    navigation.redirect.mockClear();
  });

  it("未登录用户返回登录页", async () => {
    auth.getCurrentMember.mockResolvedValue(null);

    await expect(
      ProfileOnboardingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("保留旧资料并让未完成成员修正", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: false,
    });
    profiles.getOwnProfile.mockResolvedValue({
      displayName: "需要修正的旧名称",
      major: null,
      gradYear: null,
      avatarUrl: null,
    });

    render(
      await ProfileOnboardingPage({ searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByTestId("profile-form").textContent).toBe(
      "需要修正的旧名称",
    );
  });
});
