// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardHeader } from "./dashboard-header";

afterEach(cleanup);

describe("dashboard header", () => {
  it("provides the authenticated member a direct friends entry", () => {
    render(
      <DashboardHeader
        email="alice@wisc.edu"
        schoolName="UW–Madison"
        signOutAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "好友" }).getAttribute("href"))
      .toBe("/friends");
  });
});
