import type { EnabledSchool } from "./queries";

/** 邮箱 @ 后面的部分，小写；还没输到 @ 或后面为空时返回 null。 */
export function emailDomain(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.trim().slice(at + 1).toLowerCase();
  return domain || null;
}

/**
 * 按邮箱后缀找到对应学校。和服务端准入一样是精确匹配：子域名
 * （如 cs.wisc.edu）不算 wisc.edu，免得这里显示"已识别"、发码时却被拒。
 */
export function schoolForEmail(
  schools: EnabledSchool[],
  email: string,
): EnabledSchool | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return schools.find((school) => school.emailDomains.includes(domain)) ?? null;
}
