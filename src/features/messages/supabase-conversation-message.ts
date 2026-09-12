export type ConversationMessage = {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  body: string;
  createdAt: string;
};

export type ConversationMessageSendResult =
  | { status: "sent"; message: ConversationMessage }
  | {
      status:
        | "onboarding_required"
        | "invalid_request"
        | "invalid_body"
        | "not_available"
        | "not_allowed"
        | "idempotency_conflict";
    };

type RpcResult = { data: unknown; error: unknown };

export interface ConversationMessageRpcClient {
  rpc(
    name: "send_conversation_message",
    arguments_: {
      target_conversation_id: string;
      client_message_id: string;
      message_body: string;
    },
  ): PromiseLike<RpcResult>;
}

export async function sendSupabaseConversationMessage(
  client: ConversationMessageRpcClient,
  conversationId: string,
  clientMessageId: string,
  body: string,
): Promise<ConversationMessageSendResult> {
  const { data, error } = await client.rpc("send_conversation_message", {
    target_conversation_id: conversationId,
    client_message_id: clientMessageId,
    message_body: body,
  });
  if (error) throw error;

  const row = Array.isArray(data) && data[0] && typeof data[0] === "object"
    ? (data[0] as Record<string, unknown>)
    : {};
  const status = String(row.result_status ?? "not_available");
  if (status !== "sent") {
    const knownStatus = [
      "onboarding_required",
      "invalid_request",
      "invalid_body",
      "not_available",
      "not_allowed",
      "idempotency_conflict",
    ].includes(status)
      ? status as Exclude<ConversationMessageSendResult["status"], "sent">
      : "not_available";
    return { status: knownStatus };
  }
  if (
    row.message_id === null || row.message_id === undefined ||
    !row.conversation_id || !row.sender_id || !row.sender_display_name ||
    typeof row.body !== "string" || !row.created_at
  ) {
    throw new Error("Invalid sent message response");
  }
  return {
    status: "sent",
    message: {
      id: String(row.message_id),
      clientMessageId,
      conversationId: String(row.conversation_id),
      senderId: String(row.sender_id),
      senderDisplayName: String(row.sender_display_name),
      body: row.body,
      createdAt: String(row.created_at),
    },
  };
}
