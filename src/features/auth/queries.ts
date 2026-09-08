import "server-only";

import { createClient } from "@/lib/supabase/server";

export type EnabledSchool = {
  id: string;
  nameEn: string;
  nameZh: string;
  /** 该校已开放的完整邮箱域名。精确匹配，子域名不继承。 */
  emailDomains: string[];
};

export async function getEnabledSchools(): Promise<EnabledSchool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schools")
    .select("id, name_en, name_zh, school_email_domains(domain)")
    .order("name_en");

  if (error) throw error;
  return (data ?? []).map((school) => ({
    id: school.id,
    nameEn: school.name_en,
    nameZh: school.name_zh,
    // 最短的排前面：一所学校配多个域名时，主域名通常最短，用它做输入提示最不容易误导。
    emailDomains: school.school_email_domains
      .map((row) => row.domain)
      .sort((left, right) => left.length - right.length || left.localeCompare(right)),
  }));
}
