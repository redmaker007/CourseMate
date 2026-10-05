"use client";

import { useSyncExternalStore } from "react";

import {
  parseThemePreference,
  themeCookieString,
  type ThemePreference,
} from "./theme-preference";

// 当前偏好以 <html data-theme> 为准：服务端按 cookie 写好，切换时这里同步改。
const listeners = new Set<() => void>();
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.theme);
}

export function writeThemePreference(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
  document.cookie = themeCookieString(preference);
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // 跟随系统时，系统切换深浅色也要让图标跟着变
  const media = window.matchMedia?.(DARK_QUERY);
  media?.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    media?.removeEventListener("change", onChange);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}

/** 实际生效的是深色还是浅色（把「跟随系统」换算成具体结果）。 */
export function useResolvedDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const preference = readPreference();
      if (preference !== "system") return preference === "dark";
      return window.matchMedia?.(DARK_QUERY).matches ?? false;
    },
    () => false,
  );
}
