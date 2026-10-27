import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseMemberSessionReader } from "@/features/auth/supabase-email-otp-adapters";

import { createProfileService, type ProfileServiceDependencies } from "./profile-service";

export function createSupabaseProfileService(
  supabase: SupabaseClient,
  getCurrentMember: ProfileServiceDependencies["getCurrentMember"] = () =>
    createSupabaseMemberSessionReader(supabase).getMemberSession(),
) {
  return createProfileService({
    getCurrentMember,
    async saveOwnProfile(profile) {
      const fields = {
        display_name: profile.displayName,
        major: profile.major,
        grad_year: profile.gradYear,
      };
      // 受限列没有 SELECT 权限，upsert 会失败；保留网站已有 insert 后按冲突 update 的流程。
      const { error: insertError } = await supabase
        .from("profiles")
        .insert({ id: profile.userId, ...fields });
      if (!insertError) return;
      if (insertError.code !== "23505") throw insertError;
      const { error } = await supabase.from("profiles").update(fields).eq("id", profile.userId);
      if (error) throw error;
    },
  });
}
