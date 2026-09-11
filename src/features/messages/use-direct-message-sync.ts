"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import type { DirectMessage } from "./direct-message-service";
import {
  directMessagePollingDelayMs,
  mergeDirectMessages,
  reconnectCursor,
} from "./direct-message-sync";

type BackfillResponse = {
  messages: DirectMessage[];
  hasMore: boolean;
};

export function useDirectMessageSync({
  conversationId,
  initialMessages,
  initialHasOlderMessages,
}: {
  conversationId: string;
  initialMessages: DirectMessage[];
  initialHasOlderMessages: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hasOlderMessages, setHasOlderMessages] = useState(
    initialHasOlderMessages,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesRef = useRef(initialMessages);
  const backfillRef = useRef<Promise<boolean> | null>(null);
  const resyncRequestedRef = useRef(false);

  const mergeIncoming = useCallback((incoming: DirectMessage[]) => {
    const merged = mergeDirectMessages(messagesRef.current, incoming);
    messagesRef.current = merged;
    setMessages(merged);
  }, []);

  const backfill = useCallback(async () => {
    if (backfillRef.current) {
      resyncRequestedRef.current = true;
      return backfillRef.current;
    }
    const request = (async () => {
      try {
        do {
          resyncRequestedRef.current = false;
          let after = reconnectCursor(messagesRef.current);
          let hasMore = true;
          while (hasMore) {
            const suffix = after ? `?after=${encodeURIComponent(after)}` : "";
            const response = await fetch(
              `/api/messages/${encodeURIComponent(conversationId)}${suffix}`,
              { cache: "no-store" },
            );
            if (!response.ok) return false;
            const payload = (await response.json()) as BackfillResponse;
            mergeIncoming(payload.messages);
            hasMore = payload.hasMore;
            if (payload.messages.length === 0) break;
            const latest = reconnectCursor(payload.messages);
            if (!latest || latest === after) break;
            after = latest;
          }
        } while (resyncRequestedRef.current);
        return true;
      } catch {
        return false;
      } finally {
        backfillRef.current = null;
      }
    })();
    backfillRef.current = request;
    return request;
  }, [conversationId, mergeIncoming]);

  const loadOlder = useCallback(async () => {
    const before = messagesRef.current[0]?.id;
    if (!before) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(conversationId)}?before=${encodeURIComponent(before)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as BackfillResponse;
      mergeIncoming(payload.messages);
      setHasOlderMessages(payload.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, mergeIncoming]);

  const clearThrough = useCallback((messageId: string) => {
    const remaining = messagesRef.current.filter(
      (message) => BigInt(message.id) > BigInt(messageId),
    );
    messagesRef.current = remaining;
    setMessages(remaining);
    setHasOlderMessages(false);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`direct:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void backfill(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          void backfill();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setConnected(false);
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [backfill, conversationId]);

  useEffect(() => {
    const syncWhenVisible = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (isVisible) void backfill();
    };
    const syncWhenOnline = () => void backfill();
    window.addEventListener("focus", syncWhenVisible);
    window.addEventListener("online", syncWhenOnline);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.removeEventListener("focus", syncWhenVisible);
      window.removeEventListener("online", syncWhenOnline);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [backfill]);

  useEffect(() => {
    if (connected || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (failures: number) => {
      timer = setTimeout(async () => {
        const succeeded = await backfill();
        if (!cancelled) schedule(succeeded ? 0 : failures + 1);
      }, directMessagePollingDelayMs(failures));
    };
    schedule(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backfill, connected, visible]);

  return {
    backfill,
    clearThrough,
    connected,
    hasOlderMessages,
    loadOlder,
    loadingOlder,
    messages,
  };
}
