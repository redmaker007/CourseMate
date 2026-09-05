import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createEmailOtpService } from "./email-otp-service";
import {
  createSupabaseEmailOtpAuth,
  createSupabaseMemberSession,
  createSupabaseSchoolDirectory,
} from "./supabase-email-otp-adapters";

export async function createProductionEmailOtpService() {
  const supabase = await createClient();

  return createEmailOtpService({
    auth: createSupabaseEmailOtpAuth(supabase),
    memberSession: createSupabaseMemberSession(supabase),
    schools: createSupabaseSchoolDirectory(supabase),
  });
}
