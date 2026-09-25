// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
const measure = vi.hoisted(() => ({ network: vi.fn(), service: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("../measure-latency", () => ({
  measureNetworkLatency: measure.network,
  measureServiceLatency: measure.service,
}));

import { writeShowLatency } from "../latency-preference";
import { LATENCY_INTERVAL_MS } from "../use-latency";
import { LatencyBadge } from "./latency-badge";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("LatencyBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.pathname = "/dashboard";
    measure.network.mockReset().mockResolvedValue({ status: "ok", ms: 42 });
    measure.service.mockReset().mockResolvedValue({ status: "ok", ms: 118 });
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    writeShowLatency(false);
    window.localStorage.clear();
    vi.useRealTimers();
  });

  async function renderEnabled() {
    writeShowLatency(true);
    render(<LatencyBadge />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("开关关闭时不渲染，也不发任何测量请求", async () => {
    render(<LatencyBadge />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 2);
    });

    expect(screen.queryByText(/ms/)).toBeNull();
    expect(measure.network).not.toHaveBeenCalled();
    expect(measure.service).not.toHaveBeenCalled();
  });

  it("开启后同时显示网络和服务两个读数", async () => {
    await renderEnabled();

    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.getByText("118 ms")).toBeTruthy();
    expect(screen.getByText(/网络/)).toBeTruthy();
    expect(screen.getByText(/服务/)).toBeTruthy();
  });

  it("读数按快慢着色：快为绿，慢为红", async () => {
    measure.network.mockResolvedValue({ status: "ok", ms: 30 });
    measure.service.mockResolvedValue({ status: "ok", ms: 1500 });
    await renderEnabled();

    expect(screen.getByText("30 ms").className).toContain("emerald");
    expect(screen.getByText("1500 ms").className).toContain("rose");
  });

  it("未登录（例如登录页）时只显示网络读数", async () => {
    measure.service.mockResolvedValue({ status: "signed_out" });
    await renderEnabled();

    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.queryByText(/服务/)).toBeNull();
  });

  it("请求超时或失败时如实显示，不留旧数字", async () => {
    measure.network.mockResolvedValue({ status: "timeout" });
    measure.service.mockResolvedValue({ status: "error" });
    await renderEnabled();

    expect(screen.getByText("超时")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.queryByText(/ ms$/)).toBeNull();
  });

  it("每 15 秒重测一次", async () => {
    await renderEnabled();
    expect(measure.network).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    });

    expect(measure.network).toHaveBeenCalledTimes(2);
    expect(measure.service).toHaveBeenCalledTimes(2);
  });

  it("换页后立刻重测，且旧的定时器被清掉", async () => {
    writeShowLatency(true);
    const { rerender } = render(<LatencyBadge />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(measure.network).toHaveBeenCalledTimes(1);

    navigation.pathname = "/friends";
    rerender(<LatencyBadge />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(measure.network).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    });
    expect(measure.network).toHaveBeenCalledTimes(3);
  });

  it("关闭开关后立即消失并停止测量", async () => {
    await renderEnabled();

    await act(async () => {
      writeShowLatency(false);
      await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 3);
    });

    expect(screen.queryByText(/ms/)).toBeNull();
    expect(measure.network).toHaveBeenCalledTimes(1);
  });

  it("标签页在后台时不测量，回到前台立刻补测", async () => {
    setVisibility("hidden");
    await renderEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 2);
    });
    expect(measure.network).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(measure.network).toHaveBeenCalledTimes(1);
    expect(screen.getByText("42 ms")).toBeTruthy();
  });
});
