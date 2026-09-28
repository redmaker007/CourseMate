// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardHeader } from "./dashboard-header";

afterEach(cleanup);

describe("dashboard header", () => {
  it("显示学校与邮箱，并提供退出登录", () => {
    render(
      <DashboardHeader
        email="alice@wisc.edu"
        schoolName="UW–Madison"
        signOutAction={vi.fn()}
      />,
    );

    expect(screen.getByText("UW–Madison")).toBeTruthy();
    expect(screen.getByText(/alice@wisc\.edu/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    // 好友、个人资料入口已移到导航外壳
    expect(screen.queryByRole("link", { name: "好友" })).toBeNull();
  });

  it("只有传入管理入口时才显示管理链接", () => {
    const { rerender } = render(
      <DashboardHeader email="a@wisc.edu" schoolName="UW" signOutAction={vi.fn()} />,
    );
    expect(screen.queryByRole("link", { name: "管理" })).toBeNull();

    rerender(
      <DashboardHeader
        adminHref="/admin"
        email="a@wisc.edu"
        schoolName="UW"
        signOutAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "管理" }).getAttribute("href")).toBe("/admin");
  });
});
