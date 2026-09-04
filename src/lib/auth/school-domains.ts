/**
 * 学校邮箱域名白名单。
 *
 * ⚠️ 这一层只是给用户即时反馈的前置检查，**挡不住恶意注册**——任何人都能绕过前端
 * 直接打 Supabase Auth 接口。真正的强制必须同时做在服务端：
 *   1. Supabase Auth 的 email domain 限制，或
 *   2. 一个 auth hook / trigger，在 profile 插入时校验 email 域名。
 * 见 supabase/README.md。
 *
 * TODO(试点学校未定): 首批只开一所学校，威斯康星或密歇根待定。定了之后把对应条目
 * 的 enabled 改成 true，其余保持 false。
 */

export type School = {
  /** 数据库里用的稳定标识，定了就别改 */
  id: string;
  nameZh: string;
  nameEn: string;
  /** 该校的学生邮箱域名，含子域名 */
  domains: string[];
  enabled: boolean;
};

export const SCHOOLS: School[] = [
  {
    id: "uw-madison",
    nameZh: "威斯康星大学麦迪逊分校",
    nameEn: "University of Wisconsin–Madison",
    domains: ["wisc.edu"],
    enabled: false,
  },
  {
    id: "umich",
    nameZh: "密歇根大学",
    nameEn: "University of Michigan",
    domains: ["umich.edu"],
    enabled: false,
  },
];

export const ENABLED_SCHOOLS = SCHOOLS.filter((s) => s.enabled);

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/** 邮箱属于哪所已开放的学校；不属于任何一所返回 null */
export function schoolForEmail(email: string): School | null {
  const domain = domainOf(email);
  if (!domain) return null;

  return (
    ENABLED_SCHOOLS.find((school) =>
      school.domains.some(
        (d) => domain === d || domain.endsWith(`.${d}`),
      ),
    ) ?? null
  );
}

export function isAllowedSchoolEmail(email: string): boolean {
  return schoolForEmail(email) !== null;
}
