import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthCodeRequestResult,
  EmailOtpAuthPort,
  MemberSessionPort,
  SchoolDirectoryPort,
} from "./email-otp-service";

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
  };
}

export function createSupabaseSchoolDirectory(
  supabase: CourseMateSupabaseClient,
): SchoolDirectoryPort {
  return {
    async matchesEnabledSchool(schoolId, domain) {
      const { data, error } = await supabase
        .from("school_email_domains")
        .select("school_id")
        .eq("school_id", schoolId)
        .eq("domain", domain)
        .maybeSingle();

      if (error) throw error;
      return data?.school_id === schoolId;
    },
  };
}

export function createSupabaseMemberSession(
  supabase: CourseMateSupabaseClient,
): MemberSessionPort {
  return {
    async hasValidMemberSession() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError?.name === "AuthSessionMissingError") return false;
      if (userError) throw userError;
      if (!user) return false;

      const { data, error } = await supabase
        .from("member_accounts")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data?.user_id === user.id;
    },
  };
}
