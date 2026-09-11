import { describe, expect, it } from "vitest";

import type { DirectMessage } from "./direct-message-service";
import {
  directMessagePollingDelayMs,
  mergeDirectMessages,
  reconnectCursor,
} from "./direct-message-sync";

const message = (id: string, body = `message-${id}`): DirectMessage => ({
  id,
  conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  senderDisplayName: "Bob",
  body,
  createdAt: "2026-09-11T00:00:00Z",
});

describe("direct message reconnect sync", () => {
  it("deduplicates realtime and cursor-backfill rows in bigint-id order", () => {
    const merged = mergeDirectMessages(
      [message("9007199254740995"), message("9007199254740993")],
      [message("9007199254740994"), message("9007199254740995", "latest")],
    );

    expect(merged).toEqual([
      message("9007199254740993"),
      message("9007199254740994"),
      message("9007199254740995", "latest"),
    ]);
    expect(reconnectCursor(merged)).toBe("9007199254740995");
    expect(reconnectCursor([])).toBeNull();
  });

  it("polls every five seconds before backing off repeated failures", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(directMessagePollingDelayMs)).toEqual([
      5_000,
      5_000,
      5_000,
      10_000,
      20_000,
      40_000,
      60_000,
    ]);
  });
});
