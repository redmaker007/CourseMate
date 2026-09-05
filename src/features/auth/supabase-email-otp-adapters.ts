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
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
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

    async getMemberBinding(userId) {
      const { data, error } = await supabase
        .from("member_accounts")
        .select("user_id, school_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { userId: data.user_id, schoolId: data.school_id };
    },

    async getEnabledSchoolIdForDomain(domain) {
      const { data: schoolId, error: domainError } = await supabase.rpc(
        "enabled_school_id_for_email_domain",
        { candidate_domain: domain },
      );

      if (domainError) throw domainError;
      return schoolId;
    },
  };

  return createMemberSessionReader(data);
}
