import { describe, expect, it } from "vitest";

import { IOS_HINT_SNOOZE_MS, shouldShowIosHint } from "./ios-install-hint";

describe("shouldShowIosHint", () => {
  const now = 1_000_000_000_000;

  it("从未关闭过就显示", () => {
    expect(shouldShowIosHint(null, now)).toBe(true);
  });

  it("关闭后在冷却期内不显示", () => {
    expect(shouldShowIosHint(now - 1000, now)).toBe(false);
  });

  it("冷却期结束后再次显示", () => {
    expect(shouldShowIosHint(now - IOS_HINT_SNOOZE_MS, now)).toBe(true);
  });

  it("存储里的值损坏时当作没关闭过", () => {
    expect(shouldShowIosHint(Number.NaN, now)).toBe(true);
  });
});
