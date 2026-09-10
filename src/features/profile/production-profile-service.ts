import "server-only";

import { createSupabaseMemberSessionReader } from "@/features/auth/supabase-email-otp-adapters";
import { createClient } from "@/lib/supabase/server";

import { createProfileService } from "./profile-service";

export async function createProductionProfileService() {
  const supabase = await createClient();
  const memberSession = createSupabaseMemberSessionReader(supabase);

  return createProfileService({
    getCurrentMember: () => memberSession.getMemberSession(),
    // 不能用 upsert。好友后端把 profiles 的读取权限收窄到 id / display_name /
    // avatar_url 三列（major、grad_year 只能经 get_own_profile 读到），而
    // INSERT … ON CONFLICT DO UPDATE 要求对被更新的列有读取权限，于是整句被拒——
    // 新成员无法完成 onboarding。单独的 insert 和 update 不受影响，所以先插入，
    // 已存在（唯一约束冲突 23505）再更新。
    async saveOwnProfile(profile) {
      const fields = {
        display_name: profile.displayName,
        major: profile.major,
        grad_year: profile.gradYear,
      };

      const { error: insertError } = await supabase
        .from("profiles")
        .insert({ id: profile.userId, ...fields });
      if (!insertError) return;
      if (insertError.code !== "23505") throw insertError;

      const { error: updateError } = await supabase
        .from("profiles")
        .update(fields)
        .eq("id", profile.userId);
      if (updateError) throw updateError;
    },
  });
}
