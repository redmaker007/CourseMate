import "server-only";

import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  displayName: string;
  major: string | null;
  gradYear: number | null;
  avatarUrl: string | null;
};

export async function getOwnProfile(
  userId: string,
): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_profile");

  if (error) throw error;
  const profile = data?.[0];
  if (!profile || profile.id !== userId) return null;

  return {
    displayName: profile.display_name,
    major: profile.major,
    gradYear: profile.grad_year,
    avatarUrl: profile.avatar_url,
  };
}
