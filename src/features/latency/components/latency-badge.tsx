"use client";

import { usePathname } from "next/navigation";

import { useShowLatency } from "../latency-preference";
import type { LatencySample } from "../measure-latency";
import { useLatency } from "../use-latency";

const TONE_CLASS = {
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
} as const;

function toneFor(ms: number, [good, warn]: readonly [number, number]) {
  if (ms <= good) return TONE_CLASS.good;
  if (ms <= warn) return TONE_CLASS.warn;
  return TONE_CLASS.bad;
}

function Reading({
  label,
  sample,
  thresholds,
}: {
  label: string;
  sample: LatencySample;
  thresholds: readonly [number, number];
}) {
  // 登录页上服务读数会被 proxy 挡回登录页，没有意义，只显示网络读数。
  if (sample.status === "signed_out") return null;

  return (
    <span>
      {label}{" "}
      {sample.status === "ok" ? (
        <span className={toneFor(sample.ms, thresholds)}>{sample.ms} ms</span>
      ) : (
        <span className={TONE_CLASS.bad}>
          {sample.status === "timeout" ? "超时" : "失败"}
        </span>
      )}
    </span>
  );
}

function LatencyReadout() {
  const pathname = usePathname();
  const reading = useLatency(pathname);

  return (
    <div
      aria-live="off"
      className="pointer-events-none fixed bottom-0 left-0 z-50 flex select-none gap-2.5 rounded-tr-lg bg-slate-900/80 px-2 py-0.5 font-mono text-[11px] leading-4 text-slate-200 backdrop-blur"
    >
      {reading === null ? (
        <span>测量中…</span>
      ) : (
        <>
          <Reading label="网络" sample={reading.network} thresholds={[100, 250]} />
          <Reading label="服务" sample={reading.service} thresholds={[300, 800]} />
        </>
      )}
    </div>
  );
}

/** 开关关闭时不渲染 LatencyReadout，也就不会发任何测量请求。 */
export function LatencyBadge() {
  return useShowLatency() ? <LatencyReadout /> : null;
}
