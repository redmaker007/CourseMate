// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const service = vi.hoisted(() => ({
  listFriends: vi.fn(),
  listBlockedMembers: vi.fn(),
}));
const production = vi.hoisted(() => ({ createService: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/friends/production-friendship-service", () => ({
  createProductionFriendshipService: production.createService,
}));
vi.mock("@/features/friends/actions", () => ({ friendMutationAction: vi.fn() }));
vi.mock("@/features/friends/components/friend-workspace", () => ({
  FilteredFriendList: ({ blockedMembers, friends }: { blockedMembers: unknown[]; friends: unknown[] }) => (
    <div data-testid="filtered-list">{friends.length}:{blockedMembers.length}</div>
  ),
}));

import FilteredFriendsPage from "./page";

afterEach(cleanup);

describe("filtered friends page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({
      userId: "member-1",
      onboardingComplete: true,
    });
    production.createService.mockResolvedValue(service);
    service.listFriends.mockResolvedValue({ status: "loaded", friends: [{}, {}] });
    service.listBlockedMembers.mockResolvedValue({ status: "loaded", members: [{}] });
  });

  it("loads hidden and blocked relationships through the service", async () => {
    render(await FilteredFriendsPage());

    expect(service.listFriends).toHaveBeenCalledWith(true);
    expect(service.listBlockedMembers).toHaveBeenCalledOnce();
    expect(screen.getByTestId("filtered-list").textContent).toBe("2:1");
  });
});
