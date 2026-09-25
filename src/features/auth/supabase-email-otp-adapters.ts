import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthCodeRequestResult,
  AuthCodeVerificationResult,
  EmailOtpAuthPort,
  MemberSessionPort,
  SchoolDirectoryPort,
} from "./email-otp-service";
import {
  createMemberSessionReader,
  type MemberSessionDataPort,
} from "./member-session";
import { createSupabaseCurrentDeviceSession } from "./supabase-current-device-session";

type CourseMateSupabaseClient = SupabaseClient;

const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

const UNAVAILABLE_CODES = new Set([
  "hook_timeout",
  "hook_timeout_after_retry",
  "request_timeout",
  "unexpected_failure",
]);

export function createSupabaseEmailOtpAuth(
  supabase: CourseMateSupabaseClient,
): EmailOtpAuthPort {
  const currentDeviceSession = createSupabaseCurrentDeviceSession(supabase);

  return {
    async requestCode(email): Promise<AuthCodeRequestResult> {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (!error) return { status: "accepted" };
      if (RATE_LIMIT_CODES.has(error.code ?? "") || error.status === 429) {
        return { status: "rate_limited" };
      }
      if (
        UNAVAILABLE_CODES.has(error.code ?? "") ||
        (error.status !== undefined && error.status >= 500)
      ) {
        return { status: "unavailable" };
      }
      return { status: "delivery_failed" };
    },

    async verifyCode(email, code): Promise<AuthCodeVerificationResult> {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });

      if (!error) return { status: "verified" };
      if (RATE_LIMIT_CODES.has(error.code ?? "") || error.status === 429) {
        return { status: "rate_limited" };
      }
      if (
        UNAVAILABLE_CODES.has(error.code ?? "") ||
        (error.status !== undefined && error.status >= 500)
      ) {
        return { status: "unavailable" };
      }
      return { status: "invalid_or_expired" };
    },

    async discardSession() {
      await currentDeviceSession.signOut();
    },
  };
}

export function createSupabaseSchoolDirectory(
  supabase: CourseMateSupabaseClient,
): SchoolDirectoryPort {
  return {
    async matchesEnabledSchool(schoolId, domain) {
      const { data, error } = await supabase.rpc(
        "enabled_school_id_for_email_domain",
        { candidate_domain: domain },
      );

      if (error) throw error;
      return data === schoolId;
    },
  };
}

export function createSupabaseMemberSession(
  supabase: CourseMateSupabaseClient,
): MemberSessionPort {
  const reader = createSupabaseMemberSessionReader(supabase);

  return {
    async hasValidMemberSession() {
      return (await reader.getMemberSession()) !== null;
    },
  };
}

export function createSupabaseMemberSessionReader(
  supabase: CourseMateSupabaseClient,
) {
  const data: MemberSessionDataPort = {
    async getVerifiedUser() {
      // getClaims 用项目公钥在本地验证令牌的签名与有效期，不再为每个请求向 Auth
      // 服务器往返一次。代价：令牌被撤销（如别处退出登录）要等它过期才失效，所以
      // Supabase 的 JWT expiry 要保持较短。删除用户仍然立即生效——下面读取成员账号时
      // 会查不到。
      const { data, error } = await supabase.auth.getClaims();

      if (error?.name === "AuthSessionMissingError") return null;
      if (error) throw error;

      // 没有会话时 data 为 null 而不是报错。
      const claims = data?.claims;
      if (
        typeof claims?.sub !== "string" ||
        typeof claims.email !== "string" ||
        !claims.email
      ) {
        return null;
      }

      return { id: claims.sub, email: claims.email };
    },

    async getMemberFacts(emailDomain) {
      const { data, error } = await supabase.rpc("get_member_context", {
        candidate_domain: emailDomain,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : null;
      // 没有成员账号时函数返回零行。形状不对的行也按没有处理，不放行。
      if (
        !row ||
        typeof row.user_id !== "string" ||
        typeof row.home_school_id !== "string"
      ) {
        return null;
      }

      return {
        userId: row.user_id,
        homeSchoolId: row.home_school_id,
        enabledSchoolId: row.enabled_school_id ?? null,
        currentSchoolId: row.current_school_id ?? null,
        onboardingComplete: row.onboarding_complete === true,
      };
    },
  };

  return createMemberSessionReader(data);
}
