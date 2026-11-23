// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PrivacyPage from "./page";

describe("隐私政策页", () => {
  afterEach(() => cleanup());

  it("列出收集的数据、第三方服务、保留与永久注销", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "隐私政策" })).toBeTruthy();
    for (const name of [
      "一、我们收集的数据",
      "四、我们使用的第三方服务",
      "五、数据保留多久",
      "六、永久注销账号",
      "十一、联系我们",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    const text = document.body.textContent ?? "";
    for (const fact of ["学校邮箱", "推送令牌", "Supabase", "Vercel", "Brevo", "APNs", "[消息已删除]"]) {
      expect(text).toContain(fact);
    }
  });

  it("公开联系邮箱未决定时不显示占位地址", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("公开联系邮箱尚未公布，公布后会写在这里。")).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
