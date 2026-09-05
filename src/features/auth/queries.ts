import "server-only";

import { createClient } from "@/lib/supabase/server";

export type EnabledSchool = {
  id: string;
  nameEn: string;
  nameZh: string;
};

export async function getEnabledSchools(): Promise<EnabledSchool[]> {
  const supabase = await createClient();
  const untypedSupabase = supabase as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data, error } = await untypedSupabase
    .from("schools")
    .select("id, name_en, name_zh")
    .order("name_en");

  if (error) throw error;
  return (data ?? []).map((school) => ({
    id: String(school.id),
    nameEn: String(school.name_en),
    nameZh: String(school.name_zh),
  }));
}
