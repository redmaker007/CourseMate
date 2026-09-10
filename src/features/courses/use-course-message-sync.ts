"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  mergeMessages,
  pollingDelayMs,
  type SyncedCourseMessage,
} from "./message-sync";

type BackfillResponse = {
  messages: SyncedCourseMessage[];
  hasMore: boolean;
};

export function useCourseMessageSync({
  courseId,
  conversationId,
  initialMessages,
  initialHasOlderMessages,
}: {
  courseId: string;
  conversationId: string;
  initialMessages: SyncedCourseMessage[];
  initialHasOlderMessages: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const messagesRef = useRef(initialMessages);
  const syncingRef = useRef<Promise<boolean> | null>(null);
  const resyncRequestedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );
  const [hasOlderMessages, setHasOlderMessages] = useState(
    initialHasOlderMessages,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);

  const mergeIncoming = useCallback((incoming: SyncedCourseMessage[]) => {
    setMessages((current) => {
      const merged = mergeMessages(current, incoming);
      messagesRef.current = merged;
      return merged;
    });
  }, []);

  const backfill = useCallback(() => {
    if (syncingRef.current) {
      resyncRequestedRef.current = true;
      return syncingRef.current;
    }

    const request = (async () => {
      try {
        do {
          resyncRequestedRef.current = false;
          let after = messagesRef.current.at(-1)?.id ?? 0;
          let hasMore = true;
          while (hasMore) {
            const response = await fetch(
              `/api/courses/${courseId}/messages?after=${after}`,
              { cache: "no-store" },
            );
            if (!response.ok) return false;
            const payload = (await response.json()) as BackfillResponse;
            mergeIncoming(payload.messages);
            const lastId = payload.messages.at(-1)?.id;
            if (lastId === undefined || lastId <= after) break;
            after = lastId;
            hasMore = payload.hasMore;
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
  }, [courseId, mergeIncoming]);

  const loadOlder = useCallback(async () => {
    const before = messagesRef.current[0]?.id;
    if (before === undefined) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/courses/${courseId}/messages?before=${before}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as BackfillResponse;
      mergeIncoming(payload.messages);
      setHasOlderMessages(payload.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [courseId, mergeIncoming]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`course:${conversationId}`)
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
    window.addEventListener("focus", syncWhenVisible);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.removeEventListener("focus", syncWhenVisible);
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
    connected,
    hasOlderMessages,
    loadOlder,
    loadingOlder,
    mergeIncoming,
    messages,
  };
}
