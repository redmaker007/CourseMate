import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

import { createCourseService, type CourseCatalogEntry } from "./course-service";

export async function getSupabaseCurrentTerm(supabase: SupabaseClient<Database>, schoolId: string) {
  const { data, error } = await supabase.from("school_term_settings")
    .select("current_term").eq("school_id", schoolId).maybeSingle();
  if (error) throw error;
  return data?.current_term ?? null;
}

export function createSupabaseCourseSearch(supabase: SupabaseClient<Database>, currentTerm?: string | null) {
  return createCourseService({
    getCurrentTerm: schoolId => currentTerm === undefined ? getSupabaseCurrentTerm(supabase, schoolId) : Promise.resolve(currentTerm),
    async listCatalogCourses({ schoolId, term }) {
      const pageSize = 500;
      const courses: CourseCatalogEntry[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from("courses")
          .select("id, school_id, code, title, term").eq("school_id", schoolId).eq("term", term)
          .order("code_normalized").order("id").range(offset, offset + pageSize - 1);
        if (error) throw error;
        courses.push(...(data ?? []).map(row => ({ id: row.id, schoolId: row.school_id, code: row.code, title: row.title, term: row.term })));
        if ((data ?? []).length < pageSize) return courses;
      }
    },
  });
}
