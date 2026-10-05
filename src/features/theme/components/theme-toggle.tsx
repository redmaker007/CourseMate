"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import type { ThemePreference } from "../theme-preference";
import {
  useResolvedDark,
  useThemePreference,
  writeThemePreference,
} from "../use-theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

/** 设置页里的三选一：浅色 / 深色 / 跟随系统。 */
export function ThemeSelector() {
  const current = useThemePreference();

  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">外观</legend>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-panel p-1">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
              current === value ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
            key={value}
          >
            <input
              checked={current === value}
              className="sr-only"
              name="theme"
              onChange={() => writeThemePreference(value)}
              type="radio"
              value={value}
            />
            <Icon size={14} strokeWidth={1.75} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 导航栏底部的快捷切换：一键在深浅之间切换（会从「跟随系统」变成手动选择）。 */
export function ThemeQuickToggle() {
  const dark = useResolvedDark();
  const label = dark ? "切换到浅色" : "切换到深色";

  return (
    <button
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-panel hover:text-ink"
      onClick={() => writeThemePreference(dark ? "light" : "dark")}
      title={label}
      type="button"
    >
      {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  );
}
