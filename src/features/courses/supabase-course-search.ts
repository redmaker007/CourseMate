import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

import { createCourseService, type CourseCatalogEntry } from "./course-service";

/** 每类候选最多取多少行；排序和截断到 50 条由课程服务完成。 */
const CANDIDATE_LIMIT = 100;
const PAGE_SIZE = 1000;

type CourseRow = { id: string; school_id: string; code: string; title: string; term: string };

const toEntry = (row: CourseRow): CourseCatalogEntry => ({
  id: row.id, schoolId: row.school_id, code: row.code, title: row.title, term: row.term,
});

/** ILIKE 里的 % _ \ 按字面匹配，学生输入的符号不能变成通配符。 */
export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function getSupabaseCurrentTerm(supabase: SupabaseClient<Database>, schoolId: string) {
  const { data, error } = await supabase.from("school_term_settings")
    .select("current_term").eq("school_id", schoolId).maybeSingle();
  if (error) throw error;
  return data?.current_term ?? null;
}

export function createSupabaseCourseSearch(supabase: SupabaseClient<Database>, currentTerm?: string | null) {
  const scoped = (schoolId: string, term: string) => supabase.from("courses")
    .select("id, school_id, code, title, term").eq("school_id", schoolId).eq("term", term);

  return createCourseService({
    getCurrentTerm: schoolId => currentTerm === undefined ? getSupabaseCurrentTerm(supabase, schoolId) : Promise.resolve(currentTerm),

    async findCandidateCourses({ schoolId, term, codePrefixes, titleTerm }) {
      // 课号前缀只含字母数字（已规范化），可以直接拼进 or 过滤；课名关键词走单独的
      // ilike 参数，由客户端负责转义，不拼字符串。
      const [codeResult, titleResult] = await Promise.all([
        codePrefixes.length
          ? scoped(schoolId, term)
            .or(codePrefixes.map(prefix => `code_normalized.like.${prefix}*`).join(","))
            .order("code_normalized").order("id").limit(CANDIDATE_LIMIT)
          : Promise.resolve({ data: [] as CourseRow[], error: null }),
        titleTerm
          ? scoped(schoolId, term).ilike("title", `%${escapeLikePattern(titleTerm)}%`)
            .order("code_normalized").order("id").limit(CANDIDATE_LIMIT)
          : Promise.resolve({ data: [] as CourseRow[], error: null }),
      ]);
      if (codeResult.error) throw codeResult.error;
      if (titleResult.error) throw titleResult.error;

      const byId = new Map<string, CourseCatalogEntry>();
      for (const row of [...(codeResult.data ?? []), ...(titleResult.data ?? [])]) {
        byId.set(row.id, toEntry(row));
      }
      return [...byId.values()];
    },

    async listCatalogCourses({ schoolId, term }) {
      // 只有近似匹配才会走到这里。先拿总数，其余分页并行取，免得上万门课串行几十轮。
      const page = (offset: number) => scoped(schoolId, term)
        .order("code_normalized").order("id").range(offset, offset + PAGE_SIZE - 1);
      const [first, { count, error: countError }] = await Promise.all([
        page(0),
        supabase.from("courses")
          .select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("term", term),
      ]);
      if (first.error) throw first.error;
      if (countError) throw countError;

      const offsets: number[] = [];
      for (let offset = PAGE_SIZE; offset < (count ?? 0); offset += PAGE_SIZE) offsets.push(offset);
      const rest = await Promise.all(offsets.map(page));
      const courses = (first.data ?? []).map(toEntry);
      for (const result of rest) {
        if (result.error) throw result.error;
        courses.push(...(result.data ?? []).map(toEntry));
      }
      return courses;
    },
  });
}
