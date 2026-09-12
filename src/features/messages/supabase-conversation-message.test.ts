import { describe, expect, it, vi } from "vitest";

import { sendSupabaseConversationMessage } from "./supabase-conversation-message";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Supabase conversation message send boundary", () => {
  it("returns the saved message from one unified RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          result_status: "sent",
          message_id: "9007199254740993",
          conversation_id: CONVERSATION_ID,
          sender_id: "member-1",
          sender_display_name: "Alice",
          body: "hello",
          created_at: "2026-09-12T00:00:00Z",
        },
      ],
      error: null,
    });

    await expect(
      sendSupabaseConversationMessage(
        { rpc },
        CONVERSATION_ID,
        CLIENT_MESSAGE_ID,
        "hello",
      ),
    ).resolves.toEqual({
      status: "sent",
      message: {
        id: "9007199254740993",
        clientMessageId: CLIENT_MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        senderId: "member-1",
        senderDisplayName: "Alice",
        body: "hello",
        createdAt: "2026-09-12T00:00:00Z",
      },
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("send_conversation_message", {
      target_conversation_id: CONVERSATION_ID,
      client_message_id: CLIENT_MESSAGE_ID,
      message_body: "hello",
    });
  });

  it("returns a denied status without inventing a message", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ result_status: "not_allowed", message_id: null }],
      error: null,
    });

    await expect(
      sendSupabaseConversationMessage(
        { rpc },
        CONVERSATION_ID,
        CLIENT_MESSAGE_ID,
        "hello",
      ),
    ).resolves.toEqual({ status: "not_allowed" });
  });
});
