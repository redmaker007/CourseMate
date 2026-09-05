import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createSignOutService } from "./sign-out-service";
import { createSupabaseCurrentDeviceSession } from "./supabase-current-device-session";

export async function createProductionSignOutService() {
  const supabase = await createClient();
  return createSignOutService(createSupabaseCurrentDeviceSession(supabase));
}
