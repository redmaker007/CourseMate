// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SupportPage from "../support/page";
import TermsPage from "../terms/page";
import PrivacyPageEn from "./en/page";
import PrivacyPage from "./page";

describe("公开政策页", () => {
  afterEach(() => cleanup());

  it("隐私政策列出收集的数据、第三方服务、保留与永久注销", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "隐私政策" })).toBeTruthy();
    for (const name of ["一、我们收集的数据", "四、我们使用的第三方服务", "五、数据保留多久", "六、永久注销账号", "十一、联系我们"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    const text = document.body.textContent ?? "";
    for (const fact of ["学校邮箱", "推送令牌", "Supabase", "Vercel", "Brevo", "APNs", "[消息已删除]", "一年后删除", "设置 → 注销账号", "个人开发者"]) {
      expect(text).toContain(fact);
    }
    expect(screen.getByRole("link", { name: "English version" }).getAttribute("href")).toBe("/privacy/en");
  });

  it("英文版覆盖相同章节", () => {
    render(<PrivacyPageEn />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(11);
    expect(document.querySelector("main")?.getAttribute("lang")).toBe("en");
  });

  it("用户协议写明零容忍规则与处理方式，帮助页给出联系方式与常见问题", () => {
    render(<TermsPage />);
    expect(document.body.textContent).toContain("零容忍");
    expect(document.body.textContent).toContain("24–48 小时");
    cleanup();
    render(<SupportPage />);
    expect(screen.getByRole("heading", { level: 2, name: "联系我们" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "注销账号" })).toBeTruthy();
  });

  it("公开联系邮箱未决定时不显示占位地址", () => {
    for (const Page of [PrivacyPage, PrivacyPageEn, TermsPage, SupportPage]) {
      render(<Page />);
      expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
      cleanup();
    }
  });
});
