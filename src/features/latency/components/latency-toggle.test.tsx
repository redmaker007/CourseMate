// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { writeShowLatency } from "../latency-preference";
import { LatencyToggle } from "./latency-toggle";

const KEY = "coursemate:show-latency";

describe("LatencyToggle", () => {
  afterEach(() => {
    cleanup();
    writeShowLatency(false);
    window.localStorage.clear();
  });

  it("默认关闭", () => {
    render(<LatencyToggle />);

    const checkbox = screen.getByRole("checkbox", { name: /显示网络延迟/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("勾选后保存到本机，取消勾选后清除", () => {
    render(<LatencyToggle />);
    const checkbox = screen.getByRole("checkbox", {
      name: /显示网络延迟/,
    }) as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("已开启时进入页面就是勾选状态", () => {
    writeShowLatency(true);
    render(<LatencyToggle />);

    expect(
      (screen.getByRole("checkbox", { name: /显示网络延迟/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
