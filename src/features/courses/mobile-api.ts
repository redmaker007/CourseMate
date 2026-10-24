import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberContext } from "@/features/auth/member-session";
import type { Database } from "@/types/database";
import { readMobilePagination } from "@/lib/mobile-pagination";
import { createSupabaseCourseSearch, getSupabaseCurrentTerm } from "./supabase-course-search";
import { createSupabaseCourseOperations, getSupabaseJoinedCourse } from "./supabase-course-operations";
import { isUuid } from "./course-identifiers";

export function mobileCourseMethods(path: string) {
  if (path === "courses" || path === "courses/search") return ["GET"];
  if (/^courses\/[^/]+$/.test(path)) return ["GET"];
  if (/^courses\/[^/]+\/(join|leave)$/.test(path)) return ["POST"];
  return undefined;
}

export async function handleMobileCourseRequest(
  request: Request,
  path: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
  member: MemberContext,
) {
  if (!member.onboardingComplete) return { status: "onboarding_required" } as const;
  const params = new URL(request.url).searchParams;
  const operationMember = { userId: member.userId, schoolId: member.currentSchoolId, onboardingComplete: member.onboardingComplete };
  if (path !== "courses" && path !== "courses/search") {
    const [, courseId, action] = path.split("/");
    if (!isUuid(courseId) || params.size || Object.keys(body).length) return { status: "invalid_request" } as const;
    // 详情与操作均先限定当前学校，不能借旧学校的选课记录取得入口。
    const { data: course, error } = await supabase.from("courses")
      .select("id, school_id, code, title, term").eq("id", courseId).eq("school_id", member.currentSchoolId).maybeSingle();
    if (error) throw error;
    if (!course) return { status: "not_available" } as const;
    if (action) {
      const currentTerm = await getSupabaseCurrentTerm(supabase, member.currentSchoolId);
      if (!currentTerm || course.term !== currentTerm) return { status: "not_available" } as const;
      const operations = createSupabaseCourseOperations(supabase, async () => operationMember);
      return action === "join" ? operations.joinCourse(courseId) : operations.leaveCourse(courseId);
    }
    const [currentTerm, access] = await Promise.all([
      getSupabaseCurrentTerm(supabase, member.currentSchoolId),
      getSupabaseJoinedCourse(supabase, operationMember, courseId),
    ]);
    if (!currentTerm || (course.term !== currentTerm && !access)) return { status: "not_available" } as const;
    const archived = course.term !== currentTerm || access?.archived === true;
    return { status: "ok", schoolId: member.currentSchoolId, currentTerm,
      course: { id: course.id, schoolId: course.school_id, code: course.code, title: course.title, term: course.term,
        joined: access !== null, conversationId: access?.conversationId ?? null, archived,
        canJoin: !access && !archived, canLeave: access !== null && !archived,
      },
    };
  }
  const search = path === "courses/search";
  const allowed = search ? ["q", "limit", "offset"] : ["scope", "limit", "offset"];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) return { status: "invalid_request" } as const;
  const page = readMobilePagination(params);
  const scope = params.get("scope") ?? "current";
  if (!page || !["current", "archived"].includes(scope)) return { status: "invalid_request" } as const;
  const query = params.get("q")?.trim() ?? "";
  if (search && (!query || Array.from(query).length > 120)) return { status: "invalid_request" } as const;
  const currentTerm = await getSupabaseCurrentTerm(supabase, member.currentSchoolId);
  if (search) {
    const matches = await createSupabaseCourseSearch(supabase, currentTerm).searchCourses(member.currentSchoolId, query);
    const courses = matches.slice(page.offset, page.offset + page.limit);
    const { data: memberships, error } = courses.length ? await supabase.from("course_members")
      .select("course_id").eq("user_id", member.userId).in("course_id", courses.map(course => course.id)) : { data: [], error: null };
    if (error) throw error;
    const joined = new Set((memberships ?? []).map(row => row.course_id));
    return { status: "ok", schoolId: member.currentSchoolId, currentTerm,
      courses: courses.map(course => ({ ...course, joined: joined.has(course.id) })),
      page: { ...page, nextOffset: matches.length > page.offset + page.limit ? page.offset + page.limit : null },
    };
  }
  const { data, error } = await supabase.rpc("get_dashboard_courses", { target_school: member.currentSchoolId })
    .eq("archived", scope === "archived").order("code").order("course_id")
    .range(page.offset, page.offset + page.limit);
  if (error) throw error;
  const rows = data ?? [];
  return {
    status: "ok",
    schoolId: member.currentSchoolId,
    currentTerm,
    courses: rows.slice(0, page.limit).map(row => ({
      id: row.course_id, schoolId: row.school_id, code: row.code, title: row.title, term: row.term,
      conversationId: row.conversation_id, archived: row.archived, memberCount: row.member_count,
    })),
    page: { ...page, nextOffset: rows.length > page.limit ? page.offset + page.limit : null },
  };
}
