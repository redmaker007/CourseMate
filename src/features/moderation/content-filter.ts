/**
 * 数据库内容过滤（迁移 202611220002）拒绝写入时抛出 SQLSTATE CM001、message=content_rejected，
 * detail 是被拦截的字段（body／message／display_name／major）。这里统一识别，
 * 各功能把它转成自己的“请修改后再发送”反馈。不回显命中的词，避免被拿来试探词表。
 */
export const CONTENT_REJECTED_MESSAGE = "内容包含不允许的词语，请修改后再发送。";

export type ContentRejectedField = "body" | "message" | "display_name" | "major";

const FIELDS: readonly ContentRejectedField[] = ["body", "message", "display_name", "major"];

/** 不是内容过滤错误时返回 null；是则返回字段名（未知字段时返回 "body"）。 */
export function contentRejectedField(error: unknown): ContentRejectedField | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (record.code !== "CM001" && record.message !== "content_rejected") return null;
  const detail = typeof record.details === "string" ? record.details : record.detail;
  return FIELDS.includes(detail as ContentRejectedField) ? detail as ContentRejectedField : "body";
}
