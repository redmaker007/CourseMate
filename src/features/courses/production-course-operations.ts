import "server-only";

import { getCurrentMember } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";

import { createSupabaseCourseOperations } from "./supabase-course-operations";

export async function createProductionCourseOperations() {
  const supabase = await createClient();
  let memberPromise: ReturnType<typeof getCurrentMember> | undefined;
  const currentMember = () => memberPromise ??= getCurrentMember();
  return createSupabaseCourseOperations(supabase, currentMember);
}
