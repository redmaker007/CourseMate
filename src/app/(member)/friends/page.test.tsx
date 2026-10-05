// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const service = vi.hoisted(() => ({
  listFriends: vi.fn(),
  listFriendRequests: vi.fn(),
}));
const production = vi.hoisted(() => ({ createService: vi.fn() }));
const messageService = vi.hoisted(() => ({ listConversationUnread: vi.fn() }));
const messageProduction = vi.hoisted(() => ({ createService: vi.fn() }));
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
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: messageProduction.createService,
}));
vi.mock("@/features/friends/actions", () => ({
  friendMutationAction: vi.fn(),
  searchFriendAction: vi.fn(),
}));
vi.mock("@/features/friends/components/friend-workspace", () => ({
  FriendWorkspace: ({ friends, requests, unreadByConversation }: { friends: unknown[]; requests: unknown[]; unreadByConversation: Record<string, number> }) => (
    <div data-testid="workspace">{friends.length}:{requests.length}:{Object.values(unreadByConversation)[0]}</div>
  ),
}));

import FriendsPage from "./page";

const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

afterEach(cleanup);

describe("friends page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    production.createService.mockResolvedValue(service);
    messageProduction.createService.mockResolvedValue(messageService);
    service.listFriends.mockResolvedValue({ status: "loaded", friends: [{}] });
    service.listFriendRequests.mockResolvedValue({ status: "loaded", requests: [{}, {}] });
    messageService.listConversationUnread.mockResolvedValue({
      status: "loaded",
      conversations: [{ conversationId: "conversation-1", unreadCount: 2 }],
    });
  });

  it("protects the page with the current complete member session", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    await expect(FriendsPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    auth.getCurrentMember.mockResolvedValue({ ...MEMBER, onboardingComplete: false });
    await expect(FriendsPage()).rejects.toThrow("NEXT_REDIRECT:/onboarding/profile");
    expect(production.createService).not.toHaveBeenCalled();
  });

  it("loads real friend and request views through the service", async () => {
    render(await FriendsPage());

    expect(service.listFriends).toHaveBeenCalledWith(false);
    expect(service.listFriendRequests).toHaveBeenCalledOnce();
    expect(messageService.listConversationUnread).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("workspace").textContent).toBe("1:2:2");
  });
});
