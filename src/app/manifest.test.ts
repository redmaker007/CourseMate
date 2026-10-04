import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

import manifest from "./manifest";

describe("web app manifest", () => {
  it("声明独立窗口显示，起始页是大厅", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/dashboard");
  });

  it("引用的图标文件都真实存在，并带一个 maskable 图标", () => {
    const icons = manifest().icons ?? [];
    for (const icon of icons) {
      expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
    }
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("proxy 不拦截 manifest，未登录的浏览器也能取到", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/manifest.webmanifest")).toBe(false);
    expect(matcher.test("/dashboard")).toBe(true);
  });
});
