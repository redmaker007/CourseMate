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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, major, grad_year, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.id !== userId) return null;

  return {
    displayName: data.display_name,
    major: data.major,
    gradYear: data.grad_year,
    avatarUrl: data.avatar_url,
  };
}
