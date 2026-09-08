import "server-only";

import { createClient } from "@/lib/supabase/server";

export type EnabledSchool = {
  id: string;
  nameEn: string;
  nameZh: string;
};

export async function getEnabledSchools(): Promise<EnabledSchool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schools")
    .select("id, name_en, name_zh")
    .order("name_en");

  if (error) throw error;
  return (data ?? []).map((school) => ({
    id: school.id,
    nameEn: school.name_en,
    nameZh: school.name_zh,
  }));
}
