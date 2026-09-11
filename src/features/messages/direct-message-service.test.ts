import { describe, expect, it, vi } from "vitest";

import {
  createDirectMessageService,
  type DirectMessageBackend,
} from "./direct-message-service";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function backend(
  overrides: Partial<DirectMessageBackend> = {},
): DirectMessageBackend {
  return {
    sendMessage: vi.fn().mockResolvedValue({ status: "sent", messageId: "1" }),
    listMessages: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue({ status: "updated" }),
    clearConversation: vi.fn().mockResolvedValue({ status: "updated" }),
    getUnreadCounts: vi.fn().mockResolvedValue({ visible: 0, hidden: 0 }),
    listConversationUnread: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("direct message service", () => {
  it("trims and sends a Unicode plain-text message up to 4000 characters", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ status: "sent", messageId: "9007199254740993" });
    const service = createDirectMessageService(backend({ sendMessage }));
    const body = `  ${"界".repeat(4000)}  `;

    await expect(service.sendMessage(CONVERSATION_ID, body)).resolves.toEqual({
      status: "sent",
      messageId: "9007199254740993",
    });
    expect(sendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "界".repeat(4000),
    );
  });

  it("rejects blank, 4001-character, and malformed conversation input", async () => {
    const sendMessage = vi.fn();
    const service = createDirectMessageService(backend({ sendMessage }));

    await expect(service.sendMessage(CONVERSATION_ID, "   ")).resolves.toEqual({
      status: "invalid_body",
    });
    await expect(
      service.sendMessage(CONVERSATION_ID, "界".repeat(4001)),
    ).resolves.toEqual({ status: "invalid_body" });
    await expect(service.sendMessage("not-a-uuid", "hello")).resolves.toEqual({
      status: "invalid_conversation",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("uses decimal strings for cursors and rejects unsafe cursor input", async () => {
    const listMessages = vi.fn().mockResolvedValue([]);
    const service = createDirectMessageService(backend({ listMessages }));

    await service.listMessages(CONVERSATION_ID, {
      direction: "before",
      cursor: "9007199254740993",
      limit: 75,
    });
    expect(listMessages).toHaveBeenCalledWith(CONVERSATION_ID, {
      direction: "before",
      cursor: "9007199254740993",
      limit: 75,
    });

    await expect(
      service.listMessages(CONVERSATION_ID, {
        direction: "after",
        cursor: "1.5",
      }),
    ).resolves.toEqual({ status: "invalid_cursor" });
  });

  it("only advances the current member's read and clear positions", async () => {
    const markRead = vi.fn().mockResolvedValue({ status: "updated" });
    const clearConversation = vi.fn().mockResolvedValue({ status: "updated" });
    const service = createDirectMessageService(
      backend({ markRead, clearConversation }),
    );

    await service.markRead(CONVERSATION_ID, "42");
    await service.clearConversation(CONVERSATION_ID, "42");

    expect(markRead).toHaveBeenCalledWith(CONVERSATION_ID, "42");
    expect(clearConversation).toHaveBeenCalledWith(CONVERSATION_ID, "42");
  });

  it("maps backend failures to a temporary status", async () => {
    const service = createDirectMessageService(
      backend({
        getUnreadCounts: vi.fn().mockRejectedValue(new Error("offline")),
      }),
    );

    await expect(service.getUnreadCounts()).resolves.toEqual({
      status: "temporarily_unavailable",
    });
  });

  it("loads an authorized conversation view without trusting route metadata", async () => {
    const getConversation = vi.fn().mockResolvedValue({
      conversationId: CONVERSATION_ID,
      otherMemberId: null,
      otherDisplayName: "Deleted member",
      sendStatus: "readonly",
      hidden: false,
    });
    const service = createDirectMessageService(backend({ getConversation }));

    await expect(service.getConversation(CONVERSATION_ID)).resolves.toEqual({
      status: "loaded",
      conversation: expect.objectContaining({ sendStatus: "readonly" }),
    });
    expect(getConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    await expect(service.getConversation("tampered")).resolves.toEqual({
      status: "invalid_conversation",
    });
  });
});
