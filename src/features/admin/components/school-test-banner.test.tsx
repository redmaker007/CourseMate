// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../school-test-actions", () => ({ setTestSchoolAction: vi.fn() }));
vi.mock("./admin-form", () => ({
  AdminForm: ({ submitLabel, children }: { submitLabel: string; children?: ReactNode }) => (
    <form aria-label={submitLabel}>{children}</form>
  ),
}));

import { SchoolTestBanner } from "./school-test-banner";

afterEach(cleanup);

const BASE = {
  userId: "admin-1",
  email: "admin@umich.edu",
  onboardingComplete: true,
};

describe("SchoolTestBanner", () => {
  it("正常使用时不显示", () => {
    const { container } = render(
      <SchoolTestBanner member={{ ...BASE, schoolId: "umich" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("跨校测试时显示当前学校与账号归属，并能一键返回本校", () => {
    render(
      <SchoolTestBanner
        member={{ ...BASE, schoolId: "uw-madison", homeSchoolId: "umich" }}
      />,
    );
    expect(screen.getByText("正在测试：uw-madison · 账号归属：umich")).toBeTruthy();

    const back = screen.getByRole("form", { name: "返回本校" });
    // 空学校 ID 表示清除测试上下文，由数据库回到邮箱归属学校
    expect((back.querySelector("input[name=schoolId]") as HTMLInputElement).value).toBe("");
  });
});
