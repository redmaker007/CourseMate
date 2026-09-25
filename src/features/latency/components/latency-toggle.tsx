"use client";

import { useShowLatency, writeShowLatency } from "../latency-preference";

export function LatencyToggle() {
  const enabled = useShowLatency();

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        checked={enabled}
        className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
        onChange={(event) => writeShowLatency(event.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">
          显示网络延迟
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
          在页面左下角显示两个毫秒读数：网络是你到服务器的往返，服务还包含登录校验和数据库。约每 15 秒测一次，只保存在这台设备上。
        </span>
      </span>
    </label>
  );
}
