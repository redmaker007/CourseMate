import { describe, expect, it } from "vitest";

import { safeRelativePath } from "./safe-relative-path";

describe("safeRelativePath", () => {
  it("保留合法的站内路径、查询参数和锚点", () => {
    expect(safeRelativePath("/friends?tab=requests#pending")).toBe(
      "/friends?tab=requests#pending",
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
  ])("拒绝可能跳转到站外的地址：%s", (value) => {
    expect(safeRelativePath(value)).toBe("/dashboard");
  });

  it("可以阻止返回指定页面及其子路径", () => {
    expect(
      safeRelativePath("/onboarding/profile/retry", {
        blockedPrefixes: ["/onboarding/profile"],
      }),
    ).toBe("/dashboard");
  });
});
