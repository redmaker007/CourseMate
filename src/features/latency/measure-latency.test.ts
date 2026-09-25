import { afterEach, describe, expect, it, vi } from "vitest";

import { measureNetworkLatency, measureServiceLatency } from "./measure-latency";

const asFetch = (fn: unknown) => fn as typeof fetch;
const reply = (init: { ok?: boolean; type?: ResponseType } = {}) =>
  ({ ok: init.ok ?? true, type: init.type ?? "basic" }) as Response;

describe("延迟测量", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("返回请求往返的毫秒数，四舍五入到整数", async () => {
    const times = [1000, 1042.6];
    const fetchImpl = vi.fn().mockResolvedValue(reply());

    const result = await measureNetworkLatency({
      fetchImpl: asFetch(fetchImpl),
      now: () => times.shift() ?? 0,
    });

    expect(result).toEqual({ status: "ok", ms: 43 });
  });

  it("网络读数只 HEAD 静态图标，且不走缓存", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply());

    await measureNetworkLatency({ fetchImpl: asFetch(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/favicon.ico",
      expect.objectContaining({ method: "HEAD", cache: "no-store" }),
    );
  });

  it("服务读数请求 /api/ping，且不跟随登录跳转", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply());

    await measureServiceLatency({ fetchImpl: asFetch(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ping",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      }),
    );
  });

  it("被 proxy 挡回登录页时视为未登录，而不是一个很小的延迟", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(reply({ ok: false, type: "opaqueredirect" }));

    expect(
      await measureServiceLatency({ fetchImpl: asFetch(fetchImpl) }),
    ).toEqual({ status: "signed_out" });
  });

  it("服务端返回错误状态时不给出毫秒数", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ ok: false }));

    expect(
      await measureServiceLatency({ fetchImpl: asFetch(fetchImpl) }),
    ).toEqual({ status: "error" });
  });

  it("网络失败时返回 error，不抛出", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    expect(
      await measureNetworkLatency({ fetchImpl: asFetch(fetchImpl) }),
    ).toEqual({ status: "error" });
  });

  it("超过超时时间取消请求并返回 timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = measureServiceLatency({
      fetchImpl: asFetch(fetchImpl),
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ status: "timeout" });
  });

  it("调用方主动取消时返回 error，不算超时", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const caller = new AbortController();

    const pending = measureNetworkLatency({
      fetchImpl: asFetch(fetchImpl),
      signal: caller.signal,
    });
    caller.abort();

    await expect(pending).resolves.toEqual({ status: "error" });
  });
});
