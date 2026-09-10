export type SyncedCourseMessage = {
  id: number;
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
};

export function mergeMessages(
  current: readonly SyncedCourseMessage[],
  incoming: readonly SyncedCourseMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

export function pollingDelayMs(consecutiveFailures: number) {
  if (consecutiveFailures <= 2) return 5_000;
  return Math.min(5_000 * 2 ** (consecutiveFailures - 2), 60_000);
}
