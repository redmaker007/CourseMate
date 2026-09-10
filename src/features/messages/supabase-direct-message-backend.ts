import type {
  DirectMessage,
  DirectMessageBackend,
} from "./direct-message-service";

type RpcResult = { data: unknown; error: unknown };

export interface DirectMessageRpcClient {
  rpc(name: string, arguments_: Record<string, unknown>): Promise<RpcResult>;
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? (data.filter((row) => row !== null && typeof row === "object") as Record<
        string,
        unknown
      >[])
    : [];
}

function firstRow(data: unknown) {
  return rows(data)[0] ?? {};
}

export function createSupabaseDirectMessageBackend(
  client: DirectMessageRpcClient,
): DirectMessageBackend {
  async function call(name: string, arguments_: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, arguments_);
    if (error) throw error;
    return data;
  }

  return {
    async sendMessage(conversationId, body) {
      const row = firstRow(
        await call("send_direct_message", {
          target_conversation_id: conversationId,
          message_body: body,
        }),
      );
      return {
        status: String(row.result_status ?? "not_available"),
        ...(row.message_id === null || row.message_id === undefined
          ? {}
          : { messageId: String(row.message_id) }),
      };
    },

    async listMessages(conversationId, page) {
      const data = await call("list_direct_messages", {
        target_conversation_id: conversationId,
        cursor_direction: page.direction,
        cursor_message_id: page.cursor || null,
        page_size: page.limit,
      });
      return rows(data).map(
        (row): DirectMessage => ({
          id: String(row.message_id),
          conversationId: String(row.conversation_id),
          senderId: row.sender_id === null ? null : String(row.sender_id),
          senderDisplayName: String(row.sender_display_name),
          body: String(row.body),
          createdAt: String(row.created_at),
        }),
      );
    },

    async markRead(conversationId, throughMessageId) {
      const data = await call("mark_direct_conversation_read", {
        target_conversation_id: conversationId,
        through_message_id: throughMessageId,
      });
      return { status: String(data ?? "not_available") };
    },

    async clearConversation(conversationId, throughMessageId) {
      const data = await call("clear_direct_conversation", {
        target_conversation_id: conversationId,
        through_message_id: throughMessageId,
      });
      return { status: String(data ?? "not_available") };
    },

    async getUnreadCounts() {
      const row = firstRow(await call("get_direct_unread_counts", {}));
      return {
        visible: Number(row.visible_unread ?? 0),
        hidden: Number(row.hidden_unread ?? 0),
      };
    },

    async listConversationUnread(includeHidden) {
      const data = await call("list_direct_conversation_unread", {
        include_hidden: includeHidden,
      });
      return rows(data).map((row) => ({
        conversationId: String(row.conversation_id),
        unreadCount: Number(row.unread_count ?? 0),
      }));
    },
  };
}
