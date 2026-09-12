export type DatabaseErrorLike =
  | { code?: string | null; message?: string | null }
  | null
  | undefined;

/**
 * 把数据库错误翻成给管理员看的话。
 *
 * 约定见 202609100006_platform_admin.sql：errcode 22023 的提示本来就是写给人看的，
 * 直接展示；42501 是没有权限；其余一律笼统处理，不把内部错误原文透出去。
 */
export function adminErrorMessage(error: DatabaseErrorLike): string {
  if (error?.code === "22023" && error.message) return error.message;
  if (error?.code === "42501") return "没有权限执行这个操作。";
  return "操作失败，请稍后重试。";
}
