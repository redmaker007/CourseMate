import type { SupabaseClient } from "@supabase/supabase-js";

import type { CurrentDeviceSessionPort } from "./sign-out-service";

export function createSupabaseCurrentDeviceSession(
  supabase: SupabaseClient,
): CurrentDeviceSessionPort {
  return {
    async signOut() {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
  };
}
