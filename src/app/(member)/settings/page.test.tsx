// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/auth/password-actions", () => ({ requestPasswordCodeAction: vi.fn(), setPasswordAction: vi.fn() }));
vi.mock("@/features/auth/queries", () => ({ getOwnPasswordStatus: vi.fn(async () => false) }));
vi.mock("@/features/auth/web-account-deletion-actions", () => ({ accountDeletionAction: vi.fn() }));
vi.mock("@/features/dashboard/actions", () => ({ signOutAndReturnToLoginAction: vi.fn() }));
vi.mock("@/lib/server-env", () => ({ serverEnv: { push: null } }));

import SettingsPage from "./page";

afterEach(cleanup);

describe("设置页", () => {
  it("未登录或未完成资料时跳转", async () => {
    auth.getCurrentMember.mockResolvedValueOnce(null);
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    auth.getCurrentMember.mockResolvedValueOnce({ userId: "member-1", onboardingComplete: false });
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/onboarding/profile");
  });

  it("包含密码、显示偏好、帮助与政策链接、退出登录和注销入口", async () => {
    auth.getCurrentMember.mockResolvedValue({ userId: "member-1", email: "me@wisc.edu", onboardingComplete: true });
    render(await SettingsPage());

    expect(screen.getByRole("checkbox", { name: /显示网络延迟/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /帮助与联系/ }).getAttribute("href")).toBe("/support");
    expect(screen.getByRole("link", { name: /用户协议与社区规范/ }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: /隐私政策/ }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("button", { name: /退出登录/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "我要注销账号" }));
    expect(screen.getByRole("button", { name: "发送验证码到 me@wisc.edu" })).toBeTruthy();
    expect(screen.getByText(/注销无法撤销/)).toBeTruthy();
  });
});
