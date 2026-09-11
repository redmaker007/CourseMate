export type SyncedCourseMessage = {
  id: string;
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
};

export { mergeMessages, pollingDelayMs } from "@/lib/message-sync";
