"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pollingDelayMs } from "@/lib/message-sync";
import { createClient } from "@/lib/supabase/client";

type MessageId = string | number;

export function useMessageSync<T extends { id: MessageId }>({
  apiPath,
  channelName,
  conversationId,
  defaultAfter,
  initialHasOlderMessages,
  initialMessages,
  merge,
}: {
  apiPath: string;
  channelName: string;
  conversationId: string;
  defaultAfter: MessageId | null;
  initialHasOlderMessages: boolean;
  initialMessages: T[];
  merge(current: readonly T[], incoming: readonly T[]): T[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const messagesRef = useRef(initialMessages);
  const syncingRef = useRef<Promise<boolean> | null>(null);
  const resyncRequestedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(
    () =>
      typeof document !== "undefined" &&
      document.visibilityState === "visible",
  );
  const [hasOlderMessages, setHasOlderMessages] = useState(
    initialHasOlderMessages,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);

  const replaceMessages = useCallback((next: T[], hasOlder = false) => {
    messagesRef.current = next;
    setMessages(next);
    setHasOlderMessages(hasOlder);
  }, []);

  const filterMessages = useCallback(
    (predicate: (message: T) => boolean) =>
      replaceMessages(messagesRef.current.filter(predicate)),
    [replaceMessages],
  );

  const mergeIncoming = useCallback(
    (incoming: T[]) => {
      const next = merge(messagesRef.current, incoming);
      messagesRef.current = next;
      setMessages(next);
    },
    [merge],
  );

  const pageUrl = useCallback(
    (direction: "after" | "before", cursor: MessageId | null) =>
      cursor === null
        ? apiPath
        : `${apiPath}?${direction}=${encodeURIComponent(String(cursor))}`,
    [apiPath],
  );

  const backfill = useCallback(() => {
    if (syncingRef.current) {
      resyncRequestedRef.current = true;
      return syncingRef.current;
    }

    const request = (async () => {
      try {
        do {
          resyncRequestedRef.current = false;
          let after = messagesRef.current.at(-1)?.id ?? defaultAfter;
          let hasMore = true;
          while (hasMore) {
            const response = await fetch(pageUrl("after", after), {
              cache: "no-store",
            });
            if (!response.ok) return false;
            const payload = (await response.json()) as {
              messages: T[];
              hasMore: boolean;
            };
            mergeIncoming(payload.messages);
            hasMore = payload.hasMore;
            const latest = messagesRef.current.at(-1)?.id ?? defaultAfter;
            if (payload.messages.length === 0 || latest === after) break;
            after = latest;
          }
        } while (resyncRequestedRef.current);
        return true;
      } catch {
        return false;
      } finally {
        syncingRef.current = null;
      }
    })();
    syncingRef.current = request;
    return request;
  }, [defaultAfter, mergeIncoming, pageUrl]);

  const loadOlder = useCallback(async () => {
    const before = messagesRef.current[0]?.id;
    if (before === undefined) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(pageUrl("before", before), {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        messages: T[];
        hasMore: boolean;
      };
      mergeIncoming(payload.messages);
      setHasOlderMessages(payload.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [mergeIncoming, pageUrl]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(channelName)
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
  }, [backfill, channelName, conversationId]);

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
      }, pollingDelayMs(failures));
    };
    schedule(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backfill, connected, visible]);

  return {
    backfill,
    connected,
    filterMessages,
    hasOlderMessages,
    loadOlder,
    loadingOlder,
    mergeIncoming,
    messages,
    replaceMessages,
  };
}
