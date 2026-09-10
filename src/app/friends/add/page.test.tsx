// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/friends/actions", () => ({ friendMutationAction: vi.fn() }));
vi.mock("@/features/friends/components/friend-workspace", () => ({
  CourseMemberRequestPanel: ({ memberId }: { memberId: string }) => (
    <div data-testid="course-member-request">{memberId}</div>
  ),
}));

import AddCourseMemberFriendPage from "./page";

const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

afterEach(cleanup);

describe("course member friend request page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: true,
    });
  });

  it("passes only a validated member id into the shared request flow", async () => {
    render(
      await AddCourseMemberFriendPage({
        searchParams: Promise.resolve({ memberId: MEMBER_ID }),
      }),
    );

    expect(screen.getByTestId("course-member-request").textContent).toBe(MEMBER_ID);
    expect(document.body.textContent).not.toContain("@");
  });

  it("rejects a forged member id before rendering an action form", async () => {
    await expect(
      AddCourseMemberFriendPage({
        searchParams: Promise.resolve({ memberId: "not-a-member-id" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/friends");
  });
});
