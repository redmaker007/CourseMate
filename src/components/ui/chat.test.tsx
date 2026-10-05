// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  avatarColorFor,
  ChatMessageRow,
  formatChatTime,
  shouldShowTimeDivider,
} from "./chat";

afterEach(cleanup);

describe("formatChatTime", () => {
  const now = new Date(2026, 8, 27, 15, 0);

  it("今天只显示时分", () => {
    expect(formatChatTime(new Date(2026, 8, 27, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("昨天显示「昨天」", () => {
    expect(formatChatTime(new Date(2026, 8, 26, 23, 30).toISOString(), now)).toBe("昨天 23:30");
  });

  it("更早显示月日，跨年再带年份", () => {
    expect(formatChatTime(new Date(2026, 8, 1, 8, 0).toISOString(), now)).toBe("9月1日 08:00");
    expect(formatChatTime(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe(
      "2025年12月31日 08:00",
    );
  });
});

describe("shouldShowTimeDivider", () => {
  it("第一条和间隔超过 5 分钟的消息显示分隔", () => {
    expect(shouldShowTimeDivider(undefined, "2026-09-27T10:00:00Z")).toBe(true);
    expect(shouldShowTimeDivider("2026-09-27T10:00:00Z", "2026-09-27T10:04:00Z")).toBe(false);
    expect(shouldShowTimeDivider("2026-09-27T10:00:00Z", "2026-09-27T10:06:00Z")).toBe(true);
  });
});

describe("avatarColorFor", () => {
  it("同一个 ID 颜色稳定，且落在 8 种课程色里", () => {
    const color = avatarColorFor("user-a");
    expect(avatarColorFor("user-a")).toBe(color);
    expect(color).toMatch(/^var\(--course-[0-7]\)$/);
    expect(avatarColorFor(null)).toBe("var(--muted)");
  });
});

describe("ChatMessageRow", () => {
  it("别人的消息显示昵称，自己的不显示", () => {
    const { rerender } = render(
      <ol>
        <ChatMessageRow body="hi" own={false} senderId="u2" senderName="Bob" />
      </ol>,
    );
    expect(screen.getByText("Bob")).toBeTruthy();

    rerender(
      <ol>
        <ChatMessageRow body="hi" own senderId="u1" senderName="Alice" />
      </ol>,
    );
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("hi")).toBeTruthy();
  });
});
