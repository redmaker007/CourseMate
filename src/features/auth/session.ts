import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createSupabaseMemberSessionReader } from "./supabase-email-otp-adapters";

export type CurrentMember = {
  userId: string;
  /** 当前业务学校；测试时由数据库选择。 */
  schoolId: string;
  /** 跨校测试时保留真实邮箱归属，正常使用时不设置。 */
  homeSchoolId?: string;
  email: string;
  onboardingComplete: boolean;
};

/**
 * 给页面用的当前成员读取器。
 *
 * 与 proxy 用的是同一个 MemberSession 定义：只有 Auth 用户和一致的
 * Member Account 绑定同时存在，才算有效会话。页面不能只看 Auth 有没有登录。
 *
 * 出错时返回 null（fail closed），与 proxy 的处理保持一致——认证服务暂时
 * 不可用时宁可当作未登录，也不要放行。
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const supabase = await createClient();

  try {
    const session = await createSupabaseMemberSessionReader(
      supabase,
    ).getMemberSession();
    if (!session) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return null;

    const [onboarding, school] = await Promise.all([
      supabase.rpc("has_completed_onboarding"),
      supabase.rpc("current_school_id"),
    ]);
    if (onboarding.error || school.error || !school.data) return null;
    const onboardingComplete = onboarding.data;

    return {
      ...session,
      schoolId: school.data,
      ...(school.data !== session.schoolId ? { homeSchoolId: session.schoolId } : {}),
      email: user.email,
      onboardingComplete: onboardingComplete === true,
    };
  } catch {
    return null;
  }
}
