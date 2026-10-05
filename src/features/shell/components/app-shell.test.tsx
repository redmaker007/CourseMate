// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ usePathname: vi.fn(() => "/dashboard") }));
vi.mock("next/navigation", () => navigation);

import { AppShell } from "./app-shell";

const data = {
  courses: [
    { id: "c1", code: "COMPSCI 300", title: "Programming II" },
    { id: "c2", code: "MATH 221", title: "Calculus" },
  ],
  directUnread: 3,
  showAdmin: false,
};

describe("AppShell", () => {
  beforeEach(() => navigation.usePathname.mockReturnValue("/dashboard"));
  afterEach(cleanup);

  it("渲染内容，并在导航栏里列出已加入的课程", () => {
    render(
      <AppShell data={data}>
        <p>页面内容</p>
      </AppShell>,
    );

    expect(screen.getByText("页面内容")).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "主导航" });
    expect(
      within(rail).getByRole("link", { name: "COMPSCI 300 Programming II" }).getAttribute("href"),
    ).toBe("/courses/c1");
    expect(within(rail).getByText("MATH 221")).toBeTruthy();
  });

  it("桌面导航栏和手机底栏都显示私聊未读数", () => {
    render(<AppShell data={data}>内容</AppShell>);
    expect(screen.getAllByText("3")).toHaveLength(2);
  });

  it("当前页面的导航项标记为 aria-current", () => {
    navigation.usePathname.mockReturnValue("/courses/c2");
    render(<AppShell data={data}>内容</AppShell>);

    const rail = screen.getByRole("navigation", { name: "主导航" });
    expect(
      within(rail).getByRole("link", { name: "MATH 221 Calculus" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(within(rail).getByRole("link", { name: "课表" }).getAttribute("aria-current")).toBeNull();
  });

  it("只有带平台身份的成员才看到管理入口", () => {
    const { rerender } = render(<AppShell data={data}>内容</AppShell>);
    expect(screen.queryByRole("link", { name: "管理后台" })).toBeNull();

    rerender(<AppShell data={{ ...data, showAdmin: true }}>内容</AppShell>);
    expect(screen.getByRole("link", { name: "管理后台" }).getAttribute("href")).toBe("/admin");
  });
});
