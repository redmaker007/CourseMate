import "server-only";

import { createSupabaseMemberSessionReader } from "@/features/auth/supabase-email-otp-adapters";
import { createClient } from "@/lib/supabase/server";

import { createProfileService } from "./profile-service";

export async function createProductionProfileService() {
  const supabase = await createClient();
  const memberSession = createSupabaseMemberSessionReader(supabase);

  return createProfileService({
    getCurrentMember: () => memberSession.getMemberSession(),
    async saveOwnProfile(profile) {
      const { error } = await supabase.from("profiles").upsert(
        {
          id: profile.userId,
          display_name: profile.displayName,
          major: profile.major,
          grad_year: profile.gradYear,
        },
        { onConflict: "id" },
      );

      if (error) throw error;
    },
  });
}
