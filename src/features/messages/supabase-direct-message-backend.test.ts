import { describe, expect, it, vi } from "vitest";

import { createSupabaseDirectMessageBackend } from "./supabase-direct-message-backend";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Supabase direct message backend", () => {
  it("maps send and list RPCs without converting bigint ids to numbers", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ result_status: "sent", message_id: "9007199254740993" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            message_id: "9007199254740993",
            conversation_id: CONVERSATION_ID,
            sender_id: null,
            sender_display_name: "已注销用户",
            body: "hello",
            created_at: "2026-09-11T00:00:00Z",
          },
        ],
        error: null,
      });
    const backend = createSupabaseDirectMessageBackend({ rpc });

    await expect(backend.sendMessage(CONVERSATION_ID, "hello")).resolves.toEqual(
      { status: "sent", messageId: "9007199254740993" },
    );
    await expect(
      backend.listMessages(CONVERSATION_ID, {
        direction: "after",
        cursor: "9007199254740992",
        limit: 50,
      }),
    ).resolves.toEqual([
      {
        id: "9007199254740993",
        conversationId: CONVERSATION_ID,
        senderId: null,
        senderDisplayName: "已注销用户",
        body: "hello",
        createdAt: "2026-09-11T00:00:00Z",
      },
    ]);
    expect(rpc).toHaveBeenNthCalledWith(2, "list_direct_messages", {
      target_conversation_id: CONVERSATION_ID,
      cursor_direction: "after",
      cursor_message_id: "9007199254740992",
      page_size: 50,
    });
  });

  it("uses actor-scoped RPCs for read, clear, and unread counts", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "updated", error: null })
      .mockResolvedValueOnce({ data: "updated", error: null })
      .mockResolvedValueOnce({
        data: [{ visible_unread: 3, hidden_unread: 2 }],
        error: null,
      });
    const backend = createSupabaseDirectMessageBackend({ rpc });

    await backend.markRead(CONVERSATION_ID, "8");
    await backend.clearConversation(CONVERSATION_ID, "8");
    await expect(backend.getUnreadCounts()).resolves.toEqual({
      visible: 3,
      hidden: 2,
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "mark_direct_conversation_read", {
      target_conversation_id: CONVERSATION_ID,
      through_message_id: "8",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "clear_direct_conversation", {
      target_conversation_id: CONVERSATION_ID,
      through_message_id: "8",
    });
  });

  it("throws Supabase errors for the service boundary to normalize", async () => {
    const failure = { message: "permission denied" };
    const backend = createSupabaseDirectMessageBackend({
      rpc: vi.fn().mockResolvedValue({ data: null, error: failure }),
    });

    await expect(backend.getUnreadCounts()).rejects.toBe(failure);
  });

  it("maps per-conversation unread rows for normal and filtered lists", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ conversation_id: CONVERSATION_ID, unread_count: 4 }],
      error: null,
    });
    const backend = createSupabaseDirectMessageBackend({ rpc });

    await expect(backend.listConversationUnread(true)).resolves.toEqual([
      { conversationId: CONVERSATION_ID, unreadCount: 4 },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_direct_conversation_unread", {
      include_hidden: true,
    });
  });

  it("maps the authorized conversation view and preserves a missing result", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{
          conversation_id: CONVERSATION_ID,
          other_member_id: null,
          other_display_name: "Deleted member",
          send_status: "readonly",
          hidden: false,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const backend = createSupabaseDirectMessageBackend({ rpc });

    await expect(backend.getConversation(CONVERSATION_ID)).resolves.toEqual({
      conversationId: CONVERSATION_ID,
      otherMemberId: null,
      otherDisplayName: "Deleted member",
      sendStatus: "readonly",
      hidden: false,
    });
    await expect(backend.getConversation(CONVERSATION_ID)).resolves.toBeNull();
  });
});
