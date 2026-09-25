"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "coursemate:show-latency";
const listeners = new Set<() => void>();
// 只在浏览器拒绝写存储（如隐私模式）时使用，让开关在本次会话内仍然生效。
let memoryValue: boolean | null = null;

// 偏好只存在这台设备的浏览器里：它是显示习惯，不是账号数据，不进数据库。
export function readShowLatency(): boolean {
  if (memoryValue !== null) return memoryValue;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowLatency(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
    memoryValue = null;
  } catch {
    memoryValue = enabled;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useShowLatency() {
  return useSyncExternalStore(subscribe, readShowLatency, () => false);
}
