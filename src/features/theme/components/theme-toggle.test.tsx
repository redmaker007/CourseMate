// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseThemePreference, themeCookieString } from "../theme-preference";
import { ThemeQuickToggle, ThemeSelector } from "./theme-toggle";

describe("parseThemePreference", () => {
  it("只接受 light / dark / system，其余一律跟随系统", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference("<script>")).toBe("system");
  });

  it("cookie 全站有效、一年过期", () => {
    expect(themeCookieString("dark")).toBe(
      "coursemate-theme=dark; path=/; max-age=31536000; samesite=lax",
    );
  });
});

describe("主题切换", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "system";
    document.cookie = "coursemate-theme=; path=/; max-age=0";
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it("设置页选深色：改 data-theme 并写 cookie", () => {
    render(<ThemeSelector />);
    expect((screen.getByRole("radio", { name: "跟随系统" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "深色" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("coursemate-theme=dark");
    expect((screen.getByRole("radio", { name: "深色" }) as HTMLInputElement).checked).toBe(true);
  });

  it("导航栏快捷按钮在深浅之间切换，并和设置页同步", () => {
    render(
      <>
        <ThemeQuickToggle />
        <ThemeSelector />
      </>,
    );

    // 系统是浅色时，按钮提示切换到深色
    fireEvent.click(screen.getByRole("button", { name: "切换到深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect((screen.getByRole("radio", { name: "深色" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "切换到浅色" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
