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
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  usePathname: vi.fn(() => "/friends"),
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
vi.mock("@/features/friends/components/friend-relationship-management", () => ({
  FriendCard: ({ friend, unreadCount }: { friend: { effectiveName: string }; unreadCount: number }) => (
    <li data-testid="friend-card">{friend.effectiveName}:{unreadCount}</li>
  ),
  RequestHistory: ({ requests }: { requests: unknown[] }) => (
    <div data-testid="requests">{requests.length}</div>
  ),
}));

import FriendDetailPage from "./[memberId]/page";
import FriendsPage from "./page";
import FriendRequestsPage from "./requests/page";

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

  it("桌面端右栏显示空状态，不重复读取左栏已经取过的数据", async () => {
    render(await FriendsPage());

    expect(screen.getByText("选择一个会话开始聊天")).toBeTruthy();
    expect(service.listFriends).not.toHaveBeenCalled();
  });

  it("新的朋友页通过服务读取申请", async () => {
    render(await FriendRequestsPage());

    expect(service.listFriendRequests).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "新的朋友" })).toBeTruthy();
    expect(screen.getByTestId("requests").textContent).toBe("2");
  });

  it("好友详情页只显示真正的好友，并带上该会话的未读数", async () => {
    const memberId = "22222222-2222-4222-8222-222222222222";
    service.listFriends.mockResolvedValue({
      status: "loaded",
      friends: [
        { memberId, effectiveName: "鲍勃", conversationId: "conversation-1" },
      ],
    });

    render(await FriendDetailPage({ params: Promise.resolve({ memberId }) }));

    // 包含已屏蔽的好友，从「屏蔽与拉黑」点进来也能打开
    expect(service.listFriends).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("friend-card").textContent).toBe("鲍勃:2");
    expect(screen.getByRole("link", { name: "发消息" }).getAttribute("href")).toBe(
      "/messages/conversation-1",
    );
  });

  it("不是好友或 ID 不合法时返回 404", async () => {
    await expect(
      FriendDetailPage({
        params: Promise.resolve({ memberId: "99999999-9999-4999-8999-999999999999" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      FriendDetailPage({ params: Promise.resolve({ memberId: "not-a-uuid" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
