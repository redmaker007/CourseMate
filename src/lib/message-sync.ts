type MessageId = string | number;

export function mergeMessages<T extends { id: MessageId }>(
  current: readonly T[],
  incoming: readonly T[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((left, right) => {
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

export function reconnectCursor<T extends { id: MessageId }>(
  messages: readonly T[],
) {
  return messages.length ? mergeMessages([], messages).at(-1)!.id : null;
}

export function pollingDelayMs(consecutiveFailures: number) {
  if (consecutiveFailures <= 2) return 5_000;
  return Math.min(5_000 * 2 ** (consecutiveFailures - 2), 60_000);
}
