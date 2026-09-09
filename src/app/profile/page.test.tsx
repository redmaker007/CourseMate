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
vi.mock("@/features/profile/actions", () => ({ updateProfileAction: vi.fn() }));
vi.mock("@/features/profile/components/profile-form", () => ({
  ProfileForm: ({ initialProfile }: { initialProfile: { displayName: string } }) => (
    <div data-testid="profile-form">{initialProfile.displayName}</div>
  ),
}));

import ProfilePage from "./page";

afterEach(cleanup);

describe("Profile page flow", () => {
  beforeEach(() => {
    auth.getCurrentMember.mockReset();
    profiles.getOwnProfile.mockReset();
    navigation.redirect.mockClear();
  });

  it("未完成 onboarding 的成员不能直接进入资料页", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: false,
    });

    await expect(ProfilePage()).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding/profile",
    );
    expect(profiles.getOwnProfile).not.toHaveBeenCalled();
  });

  it("已完成成员看到数据库中的现有资料", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: true,
    });
    profiles.getOwnProfile.mockResolvedValue({
      displayName: "小明",
      major: "Computer Science",
      gradYear: 2028,
      avatarUrl: null,
    });

    render(await ProfilePage());

    expect(screen.getByLabelText("默认头像").textContent).toBe("小");
    expect(screen.getByTestId("profile-form").textContent).toBe("小明");
  });
});
