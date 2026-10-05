import { describe, expect, it } from "vitest";

import { detectInstallMode } from "./install-mode";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36";

describe("detectInstallMode", () => {
  it("已经是独立窗口时视为已安装，即使有安装事件", () => {
    expect(
      detectInstallMode({ standalone: true, hasInstallPrompt: true, userAgent: ANDROID }),
    ).toBe("installed");
  });

  it("有安装事件时可以一键安装", () => {
    expect(
      detectInstallMode({ standalone: false, hasInstallPrompt: true, userAgent: ANDROID }),
    ).toBe("prompt");
  });

  it("iPhone 没有安装事件，引导手动添加", () => {
    expect(
      detectInstallMode({ standalone: false, hasInstallPrompt: false, userAgent: IPHONE }),
    ).toBe("ios");
  });

  it("其他情况不显示安装入口", () => {
    expect(
      detectInstallMode({ standalone: false, hasInstallPrompt: false, userAgent: ANDROID }),
    ).toBe("unsupported");
  });
});
