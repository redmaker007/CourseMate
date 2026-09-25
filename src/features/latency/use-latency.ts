"use client";

import { useEffect, useState } from "react";

import {
  measureNetworkLatency,
  measureServiceLatency,
  type LatencySample,
} from "./measure-latency";

export const LATENCY_INTERVAL_MS = 15_000;

export type LatencyReading = {
  network: LatencySample;
  service: LatencySample;
} | null;

/**
 * 每 15 秒测一次，标签页在后台时暂停，回到前台立刻补测。
 * refreshKey 变化（换页）时重新开始，所以每次导航都会立刻得到新读数。
 */
export function useLatency(refreshKey: string): LatencyReading {
  const [reading, setReading] = useState<LatencyReading>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sampling = false;

    async function sample() {
      if (sampling || document.visibilityState !== "visible") return;
      sampling = true;
      try {
        // 依次而不是并发测：两个请求同时发会争用连接，互相拉高读数。
        const network = await measureNetworkLatency({ signal: controller.signal });
        const service = await measureServiceLatency({ signal: controller.signal });
        if (!controller.signal.aborted) setReading({ network, service });
      } finally {
        sampling = false;
      }
    }

    async function loop() {
      await sample();
      if (!controller.signal.aborted) {
        timer = setTimeout(loop, LATENCY_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void sample();
    }

    void loop();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshKey]);

  return reading;
}
