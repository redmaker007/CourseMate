import type { DirectMessage } from "./direct-message-service";

export function mergeDirectMessages(
  current: readonly DirectMessage[],
  incoming: readonly DirectMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((left, right) => {
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

export function reconnectCursor(messages: readonly DirectMessage[]) {
  if (messages.length === 0) return null;
  return messages.reduce((latest, message) =>
    BigInt(message.id) > BigInt(latest) ? message.id : latest,
  messages[0].id);
}

export function directMessagePollingDelayMs(consecutiveFailures: number) {
  if (consecutiveFailures <= 2) return 5_000;
  return Math.min(5_000 * 2 ** (consecutiveFailures - 2), 60_000);
}
