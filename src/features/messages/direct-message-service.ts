export type DirectMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderDisplayName: string;
  body: string;
  createdAt: string;
};

export type DirectMessagePage = {
  direction?: "before" | "after";
  cursor?: string;
  limit?: number;
};

export type DirectUnreadCounts = {
  visible: number;
  hidden: number;
};

export type DirectConversationUnread = {
  conversationId: string;
  unreadCount: number;
};

export type DirectConversationView = {
  conversationId: string;
  otherMemberId: string | null;
  otherDisplayName: string;
  sendStatus: "allowed" | "blocked" | "readonly";
  hidden: boolean;
};

export interface DirectMessageBackend {
  getConversation(conversationId: string): Promise<DirectConversationView | null>;
  sendMessage(
    conversationId: string,
    body: string,
  ): Promise<{ status: string; messageId?: string }>;
  listMessages(
    conversationId: string,
    page: Required<DirectMessagePage>,
  ): Promise<DirectMessage[]>;
  markRead(
    conversationId: string,
    throughMessageId: string,
  ): Promise<{ status: string }>;
  clearConversation(
    conversationId: string,
    throughMessageId: string,
  ): Promise<{ status: string }>;
  getUnreadCounts(): Promise<DirectUnreadCounts>;
  listConversationUnread(
    includeHidden: boolean,
  ): Promise<DirectConversationUnread[]>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_ID_PATTERN = /^[1-9][0-9]*$/;

function validConversationId(value: string) {
  return UUID_PATTERN.test(value);
}

function validMessageId(value: string) {
  return MESSAGE_ID_PATTERN.test(value);
}

export function createDirectMessageService(backend: DirectMessageBackend) {
  return {
    async getConversation(conversationId: string) {
      if (!validConversationId(conversationId)) {
        return { status: "invalid_conversation" } as const;
      }
      try {
        const conversation = await backend.getConversation(conversationId);
        return conversation
          ? ({ status: "loaded", conversation } as const)
          : ({ status: "not_available" } as const);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async sendMessage(conversationId: string, rawBody: string) {
      if (!validConversationId(conversationId)) {
        return { status: "invalid_conversation" } as const;
      }
      const body = rawBody.trim();
      if ([...body].length < 1 || [...body].length > 4000) {
        return { status: "invalid_body" } as const;
      }
      try {
        return await backend.sendMessage(conversationId, body);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async listMessages(conversationId: string, page: DirectMessagePage = {}) {
      if (!validConversationId(conversationId)) {
        return { status: "invalid_conversation" } as const;
      }
      if (page.cursor !== undefined && !validMessageId(page.cursor)) {
        return { status: "invalid_cursor" } as const;
      }
      const limit = page.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return { status: "invalid_limit" } as const;
      }
      const normalizedPage = {
        direction: page.direction ?? "before",
        cursor: page.cursor ?? "",
        limit,
      } satisfies Required<DirectMessagePage>;
      try {
        return {
          status: "loaded",
          messages: await backend.listMessages(conversationId, normalizedPage),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async markRead(conversationId: string, throughMessageId: string) {
      if (!validConversationId(conversationId)) {
        return { status: "invalid_conversation" } as const;
      }
      if (!validMessageId(throughMessageId)) {
        return { status: "invalid_cursor" } as const;
      }
      try {
        return await backend.markRead(conversationId, throughMessageId);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async clearConversation(conversationId: string, throughMessageId: string) {
      if (!validConversationId(conversationId)) {
        return { status: "invalid_conversation" } as const;
      }
      if (!validMessageId(throughMessageId)) {
        return { status: "invalid_cursor" } as const;
      }
      try {
        return await backend.clearConversation(conversationId, throughMessageId);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async getUnreadCounts() {
      try {
        return {
          status: "loaded",
          counts: await backend.getUnreadCounts(),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async listConversationUnread(includeHidden = false) {
      try {
        return {
          status: "loaded",
          conversations: await backend.listConversationUnread(includeHidden),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },
  };
}
