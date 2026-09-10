export type PlatformRole = "owner" | "admin";

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: "所有者",
  admin: "管理员",
};

/** 数据库返回的身份值不可预知，识别不了的一律当作没有身份。 */
export function parsePlatformRole(value: unknown): PlatformRole | null {
  return value === "owner" || value === "admin" ? value : null;
}

/**
 * 学校与邮箱域名决定谁能登录，任命管理员决定谁能进管理页——这两类只给所有者。
 *
 * 这里只决定页面上显示哪些表单。真正的限制在数据库函数里，绕过页面直接调用
 * 同样会被拒。
 */
export function isOwner(role: PlatformRole): boolean {
  return role === "owner";
}
