import "server-only";

import { notFound, redirect } from "next/navigation";

import { getCurrentMember, type CurrentMember } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import { parsePlatformRole, type PlatformRole } from "./platform-role";

export type AdminSchool = {
  id: string;
  nameZh: string;
  nameEn: string;
  enabled: boolean;
  currentTerm: string | null;
  domains: string[];
  catalogCount: number;
  currentCourseCount: number;
  memberCount: number;
};

export type StaffMember = {
  userId: string;
  email: string;
  displayName: string | null;
  role: PlatformRole;
  grantedAt: string;
};

export type AuditEntry = {
  id: number;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  details: Json;
  createdAt: string;
};

export type AdminOverview = {
  schools: AdminSchool[];
  staff: StaffMember[];
  audit: AuditEntry[];
};

/**
 * 当前成员的平台身份。读不到就当作没有身份（fail closed）：宁可让管理员暂时
 * 进不去，也不要放行。
 */
export async function getPlatformRole(): Promise<PlatformRole | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("current_platform_role");
    if (error) return null;
    return parsePlatformRole(data);
  } catch {
    return null;
  }
}

/**
 * 管理页的门禁。没有身份的人看到的是 404 而不是 403——不告诉他们这个页面存在。
 *
 * 这只是页面层的门禁。真正的授权在数据库函数里，每次调用都会重新校验。
 */
export async function requireStaff(): Promise<{
  member: CurrentMember;
  role: PlatformRole;
}> {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fadmin");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const role = await getPlatformRole();
  if (!role) notFound();

  return { member, role };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = await createClient();
  const [schools, staff, audit] = await Promise.all([
    supabase.rpc("admin_list_schools"),
    supabase.rpc("admin_list_staff"),
    supabase.rpc("admin_list_audit_log", { max_rows: 50 }),
  ]);
  if (schools.error) throw schools.error;
  if (staff.error) throw staff.error;
  if (audit.error) throw audit.error;

  return {
    schools: (schools.data ?? []).map((row) => ({
      id: row.school_id,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      enabled: row.enabled,
      currentTerm: row.current_term ?? null,
      domains: row.domains ?? [],
      catalogCount: row.catalog_count,
      currentCourseCount: row.current_course_count,
      memberCount: row.member_count,
    })),
    staff: (staff.data ?? []).flatMap((row) => {
      const role = parsePlatformRole(row.role);
      if (!role) return [];
      return [
        {
          userId: row.user_id,
          email: row.email,
          displayName: row.display_name ?? null,
          role,
          grantedAt: row.granted_at,
        },
      ];
    }),
    audit: (audit.data ?? []).map((row) => ({
      id: row.id,
      actorEmail: row.actor_email ?? null,
      actorName: row.actor_name ?? null,
      action: row.action,
      target: row.target ?? null,
      details: row.details,
      createdAt: row.created_at,
    })),
  };
}
