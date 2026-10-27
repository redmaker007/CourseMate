import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createSupabaseProfileService } from "./supabase-profile-service";

export async function createProductionProfileService() {
  const supabase = await createClient();
  return createSupabaseProfileService(supabase);
}
