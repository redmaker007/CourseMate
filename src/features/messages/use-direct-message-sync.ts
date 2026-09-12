"use client";

import { useCallback } from "react";

import { mergeMessages } from "@/lib/message-sync";
import { useMessageSync } from "@/lib/use-message-sync";

import type { DirectMessage } from "./direct-message-service";

export function useDirectMessageSync({
  conversationId,
  initialMessages,
  initialHasOlderMessages,
}: {
  conversationId: string;
  initialMessages: DirectMessage[];
  initialHasOlderMessages: boolean;
}) {
  const sync = useMessageSync({
    apiPath: `/api/messages/${encodeURIComponent(conversationId)}`,
    channelName: `direct:${conversationId}`,
    conversationId,
    defaultAfter: null,
    initialHasOlderMessages,
    initialMessages,
    merge: mergeMessages,
  });
  const { filterMessages } = sync;

  const clearThrough = useCallback(
    (messageId: string) =>
      filterMessages(
        (message) => BigInt(message.id) > BigInt(messageId),
      ),
    [filterMessages],
  );

  return { ...sync, clearThrough };
}
