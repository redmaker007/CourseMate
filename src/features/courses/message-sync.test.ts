import { describe, expect, it } from "vitest";

import { mergeMessages, pollingDelayMs } from "./message-sync";

const message = (id: string, body = `message-${id}`) => ({
  id,
  senderId: "member-1",
  senderName: "Alice",
  body,
  createdAt: "2026-09-10T00:00:00Z",
});

describe("课程群消息同步", () => {
  it("补查与 Realtime 重叠时按 ID 去重并保持确定顺序", () => {
    expect(
      mergeMessages(
        [message("9007199254740995"), message("9007199254740993")],
        [message("9007199254740994"), message("9007199254740995", "duplicate")],
      ),
    ).toEqual([
      message("9007199254740993"),
      message("9007199254740994"),
      message("9007199254740995", "duplicate"),
    ]);
  });

  it("断线时先每 5 秒轮询，连续失败后指数退避并封顶", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(pollingDelayMs)).toEqual([
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
