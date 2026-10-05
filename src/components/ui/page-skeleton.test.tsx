// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageSkeleton } from "./page-skeleton";

describe("PageSkeleton", () => {
  it("以加载中状态占位，并按行数渲染骨架块", () => {
    const { container } = render(<PageSkeleton rows={3} />);

    expect(screen.getByRole("status", { name: "加载中" })).toBeTruthy();
    // 1 个标题块 + 3 行
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });
});
