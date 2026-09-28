import { beforeEach, describe, expect, it, vi } from "vitest";

const friendService = vi.hoisted(() => ({
  listFriends: vi.fn(),
  listFriendRequests: vi.fn(),
}));
const messageService = vi.hoisted(() => ({ listConversationUnread: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./production-friendship-service", () => ({
  createProductionFriendshipService: async () => friendService,
}));
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: async () => messageService,
}));

import { loadInboxData } from "./inbox";

const friend = (memberId: string, name: string, extra: Record<string, unknown> = {}) => ({
  memberId,
  displayName: name,
  effectiveName: name,
  avatarUrl: null,
  major: "CS",
  gradYear: 2027,
  sharedCourses: [{ id: "c1", code: "CS 300", title: "P" }],
  hidden: false,
  sendStatus: "allowed",
  blockStatus: "none",
  conversationId: `conv-${memberId}`,
  ...extra,
});

describe("loadInboxData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    friendService.listFriends.mockResolvedValue({
      status: "loaded",
      friends: [
        friend("a", "Amy"),
        friend("b", "Bob"),
        friend("c", "Cat", { sendStatus: "blocked", sharedCourses: [] }),
      ],
    });
    friendService.listFriendRequests.mockResolvedValue({
      status: "loaded",
      requests: [
        { direction: "incoming", status: "pending" },
        { direction: "incoming", status: "accepted" },
        { direction: "outgoing", status: "pending" },
      ],
    });
    messageService.listConversationUnread.mockResolvedValue({
      status: "loaded",
      conversations: [{ conversationId: "conv-b", unreadCount: 4 }],
    });
  });

  it("有未读的会话排前面，只统计收到的待处理申请", async () => {
    const data = await loadInboxData();

    expect(friendService.listFriends).toHaveBeenCalledWith(false);
    expect(data.conversations.map((row) => [row.name, row.unread])).toEqual([
      ["Bob", 4],
      ["Amy", 0],
      ["Cat", 0],
    ]);
    expect(data.pendingIncoming).toBe(1);
    expect(data.unavailable).toBe(false);
  });

  it("副标题显示共同课程；被拉黑时提示无法发消息", async () => {
    const data = await loadInboxData();
    const byName = Object.fromEntries(data.conversations.map((row) => [row.name, row]));

    expect(byName.Amy.subtitle).toBe("CS 300");
    expect(byName.Cat.subtitle).toBe("当前无法互相发送消息");
    expect(byName.Cat.blocked).toBe(true);
  });

  it("某一路读取失败时其余照常，并标记 unavailable", async () => {
    messageService.listConversationUnread.mockResolvedValue({ status: "temporarily_unavailable" });
    const data = await loadInboxData();

    expect(data.conversations).toHaveLength(3);
    expect(data.conversations.every((row) => row.unread === 0)).toBe(true);
    expect(data.unavailable).toBe(true);
  });
});
