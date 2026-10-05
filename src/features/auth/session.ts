import "server-only";

import { cache } from "react";

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
 *
 * 一次页面渲染只做一次网络往返：auth.getClaims 在本地验证令牌，再用一次
 * get_member_context 取回绑定、开放学校、当前学校与 onboarding 状态。
 *
 * 用 React cache 包一层：同一次请求里导航外壳（layout）和页面各调一次，
 * 只真正查一次。cache 只在单次服务端请求内有效，不会跨请求复用会话。
 */
export const getCurrentMember = cache(async function getCurrentMember(): Promise<CurrentMember | null> {
  const supabase = await createClient();

  try {
    const context = await createSupabaseMemberSessionReader(
      supabase,
    ).getMemberContext();
    if (!context) return null;

    return {
      userId: context.userId,
      schoolId: context.currentSchoolId,
      ...(context.currentSchoolId !== context.homeSchoolId
        ? { homeSchoolId: context.homeSchoolId }
        : {}),
      email: context.email,
      onboardingComplete: context.onboardingComplete,
    };
  } catch {
    return null;
  }
});
