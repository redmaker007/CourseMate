// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readShowLatency,
  useShowLatency,
  writeShowLatency,
} from "./latency-preference";

const KEY = "coursemate:show-latency";

function Probe() {
  return <p>{useShowLatency() ? "开" : "关"}</p>;
}

describe("延迟显示偏好", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    writeShowLatency(false);
    window.localStorage.clear();
  });

  it("默认关闭", () => {
    expect(readShowLatency()).toBe(false);
  });

  it("开启后写入本机存储，关闭后清除", () => {
    writeShowLatency(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(readShowLatency()).toBe(true);

    writeShowLatency(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readShowLatency()).toBe(false);
  });

  it("同一页面里的组件会随开关变化", () => {
    render(<Probe />);
    expect(screen.getByText("关")).toBeTruthy();

    act(() => writeShowLatency(true));
    expect(screen.getByText("开")).toBeTruthy();
  });

  it("别的标签页改了开关，这个标签页跟着变", () => {
    render(<Probe />);

    act(() => {
      window.localStorage.setItem(KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(screen.getByText("开")).toBeTruthy();
  });

  it("存储被浏览器拒绝时，开关在本次会话内仍然生效且不抛错", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    render(<Probe />);

    expect(() => act(() => writeShowLatency(true))).not.toThrow();
    expect(screen.getByText("开")).toBeTruthy();
  });
});
