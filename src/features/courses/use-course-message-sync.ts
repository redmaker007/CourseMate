"use client";

import { useMessageSync } from "@/lib/use-message-sync";

import { mergeMessages, type SyncedCourseMessage } from "./message-sync";

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
  return useMessageSync({
    apiPath: `/api/courses/${courseId}/messages`,
    channelName: `course:${conversationId}`,
    conversationId,
    defaultAfter: "0",
    initialHasOlderMessages,
    initialMessages,
    merge: mergeMessages,
  });
}
