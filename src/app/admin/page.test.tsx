// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  getAdminOverview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/admin/queries", () => queries);
vi.mock("@/features/admin/actions", () => ({
  addDomainAction: vi.fn(),
  grantAdminAction: vi.fn(),
  importCatalogBatchAction: vi.fn(),
  materializeAction: vi.fn(),
  materializeCatalogForSchool: vi.fn(),
  removeDomainAction: vi.fn(),
  revokeAdminAction: vi.fn(),
  saveCatalogCourseAction: vi.fn(),
  saveSchoolAction: vi.fn(),
  setCurrentTermAction: vi.fn(),
  setSchoolEnabledAction: vi.fn(),
}));
// 表单按提交按钮的文字命名，方便断言某个表单在不在
vi.mock("@/features/admin/components/admin-form", () => ({
  AdminForm: ({ submitLabel, children }: { submitLabel: string; children?: ReactNode }) => (
    <form aria-label={submitLabel}>{children}</form>
  ),
  TextField: ({ label }: { label: string }) => <span>{label}</span>,
  SchoolSelect: () => <span>学校</span>,
}));
vi.mock("@/features/admin/components/catalog-import", () => ({
  CatalogImport: () => <div data-testid="catalog-import" />,
}));

import AdminPage from "./page";

afterEach(cleanup);

const OVERVIEW = {
  schools: [
    {
      id: "uw-madison",
      nameZh: "威斯康星大学麦迪逊分校",
      nameEn: "University of Wisconsin–Madison",
      enabled: true,
      currentTerm: "2026-fall",
      domains: ["wisc.edu"],
      catalogCount: 10,
      currentCourseCount: 10,
      memberCount: 3,
    },
  ],
  staff: [
    { userId: "u1", email: "owner@wisc.edu", displayName: "Owner", role: "owner", grantedAt: "2026-09-10T00:00:00Z" },
    { userId: "u2", email: "admin@umich.edu", displayName: "Admin", role: "admin", grantedAt: "2026-09-10T00:00:00Z" },
  ],
  audit: [],
};

const OWNER_ONLY_FORMS = ["保存学校", "添加域名", "关闭学校", "删除", "任命为管理员", "撤销管理员"];
const STAFF_FORMS = ["切换学期", "保存这门课", "重新生成"];

function form(name: string) {
  return screen.queryByRole("form", { name });
}

describe("AdminPage", () => {
  beforeEach(() => {
    queries.requireStaff.mockReset();
    queries.getAdminOverview.mockReset();
    queries.getAdminOverview.mockResolvedValue(OVERVIEW);
  });

  it("所有者看得到学校、域名与团队的全部表单", async () => {
    queries.requireStaff.mockResolvedValue({
      member: { email: "owner@wisc.edu" },
      role: "owner",
    });
    render(await AdminPage());

    for (const name of [...OWNER_ONLY_FORMS, ...STAFF_FORMS]) {
      expect(form(name), name).not.toBeNull();
    }
    expect(screen.getByTestId("catalog-import")).toBeTruthy();
  });

  it("管理员只看得到录课与切换学期，没有学校和团队的修改表单", async () => {
    queries.requireStaff.mockResolvedValue({
      member: { email: "admin@umich.edu" },
      role: "admin",
    });
    render(await AdminPage());

    for (const name of OWNER_ONLY_FORMS) expect(form(name), name).toBeNull();
    for (const name of STAFF_FORMS) expect(form(name), name).not.toBeNull();
    expect(screen.getByText("学校与域名只有所有者能修改。")).toBeTruthy();
    expect(screen.getByText("任命与撤销管理员只有所有者能操作。")).toBeTruthy();
  });

  it("没有身份时门禁直接中断，不读任何管理数据", async () => {
    queries.requireStaff.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(queries.getAdminOverview).not.toHaveBeenCalled();
  });

  it("管理数据读不到时给出提示，而不是整页报错", async () => {
    queries.requireStaff.mockResolvedValue({
      member: { email: "admin@umich.edu" },
      role: "admin",
    });
    queries.getAdminOverview.mockRejectedValue(new Error("boom"));
    render(await AdminPage());

    expect(screen.getByText("管理数据暂时不可用，请稍后刷新。")).toBeTruthy();
  });
});
