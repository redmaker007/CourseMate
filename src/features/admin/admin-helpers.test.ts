import { describe, expect, it } from "vitest";

import { adminErrorMessage } from "./admin-errors";
import {
  describeAuditAction,
  formatAuditTime,
  summarizeAuditDetails,
} from "./audit-format";
import { isOwner, parsePlatformRole } from "./platform-role";

describe("adminErrorMessage", () => {
  it("22023 是数据库写给管理员看的提示，原样展示", () => {
    expect(
      adminErrorMessage({ code: "22023", message: "当前学期已经是 2026-fall。" }),
    ).toBe("当前学期已经是 2026-fall。");
  });

  it("没有权限时就说没有权限", () => {
    expect(
      adminErrorMessage({ code: "42501", message: "没有权限执行这个管理操作" }),
    ).toBe("没有权限执行这个操作。");
  });

  it("其余错误不透出内部原文", () => {
    expect(
      adminErrorMessage({
        code: "23505",
        message: 'duplicate key value violates unique constraint "x"',
      }),
    ).toBe("操作失败，请稍后重试。");
    expect(adminErrorMessage(null)).toBe("操作失败，请稍后重试。");
  });
});

describe("parsePlatformRole", () => {
  it("只认 owner 与 admin，其余一律当作没有身份", () => {
    expect(parsePlatformRole("owner")).toBe("owner");
    expect(parsePlatformRole("admin")).toBe("admin");
    expect(parsePlatformRole("superuser")).toBeNull();
    expect(parsePlatformRole(null)).toBeNull();
    expect(parsePlatformRole(undefined)).toBeNull();
  });

  it("只有所有者能改学校和团队", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
  });
});

describe("操作记录的展示", () => {
  it("操作代号翻成中文；认不出的原样显示", () => {
    expect(describeAuditAction("term.switch")).toBe("切换学期");
    expect(describeAuditAction("something.new")).toBe("something.new");
  });

  it("细节压成一行，只挑已知字段", () => {
    expect(
      summarizeAuditDetails("term.switch", { from: null, to: "2026-fall" }),
    ).toBe("未设置 → 2026-fall");
    expect(
      summarizeAuditDetails("catalog.materialize", {
        materialized_term: "2026-fall",
        created_count: 12,
      }),
    ).toBe("2026-fall：新建 12 门");
    expect(summarizeAuditDetails("school.add_domain", { domain: "wisc.edu" })).toBe(
      "wisc.edu",
    );
    expect(summarizeAuditDetails("term.switch", ["unexpected"])).toBe("未设置 → ?");
    expect(summarizeAuditDetails("unknown.action", { any: "thing" })).toBe("");
  });

  it("时间统一显示成 UTC；解析不了就原样返回", () => {
    expect(formatAuditTime("2026-09-10T17:47:30.123+00:00")).toBe(
      "2026-09-10 17:47 UTC",
    );
    expect(formatAuditTime("2026-09-10T12:47:30-05:00")).toBe("2026-09-10 17:47 UTC");
    expect(formatAuditTime("not a time")).toBe("not a time");
  });
});
