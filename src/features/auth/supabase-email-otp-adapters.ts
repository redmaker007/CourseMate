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
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError?.name === "AuthSessionMissingError") return null;
      if (userError) throw userError;
      if (!user?.email) return null;

      return { id: user.id, email: user.email };
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
