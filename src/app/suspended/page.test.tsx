// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ currentSessionSuspended: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => session);
vi.mock("@/features/auth/web-account-deletion-actions", () => ({ accountDeletionAction: vi.fn() }));
vi.mock("@/features/dashboard/actions", () => ({ signOutAndReturnToLoginAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { email: "bob@wisc.edu" } } }) } }),
}));

import SuspendedPage from "./page";

afterEach(cleanup);

describe("账号已停用页", () => {
  it("没有停用的会话时回登录页", async () => {
    session.currentSessionSuspended.mockResolvedValueOnce(false);
    await expect(SuspendedPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("停用会话看到说明、申诉渠道、退出登录和永久注销入口", async () => {
    session.currentSessionSuspended.mockResolvedValueOnce(true);
    render(await SuspendedPage());
    expect(screen.getByRole("heading", { level: 1, name: "账号已停用" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /用户协议与社区规范/ }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "我要注销账号" })).toBeTruthy();
  });
});
