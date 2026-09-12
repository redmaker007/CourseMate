/** 数据库里记的操作代号 → 页面上显示的说法。代号定义在 202609100006_platform_admin.sql。 */
const ACTION_LABELS: Record<string, string> = {
  "staff.grant_admin": "任命管理员",
  "staff.revoke_admin": "撤销管理员",
  "school.create": "新建学校",
  "school.rename": "修改学校名称",
  "school.enable": "开放学校",
  "school.disable": "关闭学校",
  "school.add_domain": "添加邮箱域名",
  "school.remove_domain": "删除邮箱域名",
  "term.switch": "切换学期",
  "catalog.import_batch": "导入课表",
  "catalog.materialize": "生成当前学期课程",
  "catalog.save_course": "保存单门课",
};

export function describeAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** 把操作细节压成一行。只挑已知字段；认不出的结构不展示，而不是把 JSON 原样倒出来。 */
export function summarizeAuditDetails(action: string, details: unknown): string {
  const detail =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};

  switch (action) {
    case "staff.grant_admin":
      return text(detail.email) ?? "";
    case "school.create":
    case "school.rename":
      return [text(detail.name_zh), text(detail.name_en)].filter(Boolean).join(" / ");
    case "school.add_domain":
    case "school.remove_domain":
      return text(detail.domain) ?? "";
    case "term.switch":
      return `${text(detail.from) ?? "未设置"} → ${text(detail.to) ?? "?"}`;
    case "catalog.import_batch":
      return typeof detail.count === "number" ? `${detail.count} 门` : "";
    case "catalog.materialize":
      return typeof detail.created_count === "number"
        ? `${text(detail.materialized_term) ?? ""}：新建 ${detail.created_count} 门`
        : "";
    case "catalog.save_course":
      return [text(detail.code), text(detail.title)].filter(Boolean).join(" ");
    default:
      return "";
  }
}

/**
 * 统一显示成 UTC。服务端渲染时拿不到浏览器时区，而团队成员分散在不同时区，
 * 与其悄悄用服务器时区，不如明说是 UTC。
 */
export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
