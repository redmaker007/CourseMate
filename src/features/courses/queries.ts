import "server-only";

import type { CurrentMember } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";

import {
  createCourseService,
  type CourseCatalogEntry,
  type CourseSearchResult,
} from "./course-service";
import type { SyncedCourseMessage } from "./message-sync";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type CourseListItem = CourseCatalogEntry & {
  conversationId: string;
  archived: boolean;
  memberCount: number;
};

export type CourseSearchItem = CourseSearchResult & {
  joined: boolean;
};

export type CourseMemberView = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type CourseRoom = {
  course: CourseListItem;
  members: CourseMemberView[];
  messages: SyncedCourseMessage[];
  hasOlderMessages: boolean;
};

function catalogEntry(row: {
  id: string;
  school_id: string;
  code: string;
  title: string;
  term: string;
}): CourseCatalogEntry {
  return {
    id: row.id,
    schoolId: row.school_id,
    code: row.code,
    title: row.title,
    term: row.term,
  };
}

async function currentTerm(supabase: SupabaseClient, schoolId: string) {
  const { data, error } = await supabase
    .from("school_term_settings")
    .select("current_term")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data?.current_term ?? null;
}

async function catalogCourses(
  supabase: SupabaseClient,
  schoolId: string,
  term: string,
) {
  const pageSize = 500;
  const courses: CourseCatalogEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, school_id, code, title, term")
      .eq("school_id", schoolId)
      .eq("term", term)
      .order("code_normalized")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    courses.push(...(data ?? []).map(catalogEntry));
    if ((data ?? []).length < pageSize) return courses;
  }
}

export async function searchAvailableCourses(
  member: CurrentMember,
  query: string,
): Promise<CourseSearchItem[]> {
  const supabase = await createClient();
  const service = createCourseService({
    getCurrentTerm: (schoolId) => currentTerm(supabase, schoolId),
    listCatalogCourses: ({ schoolId, term }) =>
      catalogCourses(supabase, schoolId, term),
  });
  const matches = await service.searchCourses(member.schoolId, query);
  if (matches.length === 0) return [];

  const { data: memberships, error } = await supabase
    .from("course_members")
    .select("course_id")
    .eq("user_id", member.userId)
    .in(
      "course_id",
      matches.map((course) => course.id),
    );
  if (error) throw error;
  const joinedIds = new Set((memberships ?? []).map((row) => row.course_id));
  return matches.map((course) => ({
    ...course,
    joined: joinedIds.has(course.id),
  }));
}

export async function getDashboardCourses(
  member: CurrentMember,
): Promise<{ current: CourseListItem[]; archived: CourseListItem[] }> {
  const supabase = await createClient();
  const configuredTerm = await currentTerm(supabase, member.schoolId);
  if (!configuredTerm) return { current: [], archived: [] };

  const { data: memberships, error: membershipError } = await supabase
    .from("course_members")
    .select("course_id")
    .eq("user_id", member.userId);
  if (membershipError) throw membershipError;
  const courseIds = (memberships ?? []).map((row) => row.course_id);
  if (courseIds.length === 0) return { current: [], archived: [] };

  const [{ data: courses, error: courseError }, { data: links, error: linkError }] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, school_id, code, title, term")
        .eq("school_id", member.schoolId)
        .in("id", courseIds),
      supabase
        .from("course_conversations")
        .select("course_id, conversation_id")
        .in("course_id", courseIds),
    ]);
  if (courseError) throw courseError;
  if (linkError) throw linkError;

  const conversationIds = (links ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return { current: [], archived: [] };
  const [{ data: conversations, error: conversationError }, { data: memberRows, error: countError }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, archived_at")
        .in("id", conversationIds),
      supabase
        .from("conversation_members")
        .select("conversation_id")
        .in("conversation_id", conversationIds),
    ]);
  if (conversationError) throw conversationError;
  if (countError) throw countError;

  const linkByCourse = new Map(
    (links ?? []).map((row) => [row.course_id, row.conversation_id]),
  );
  const archiveByConversation = new Map(
    (conversations ?? []).map((row) => [row.id, row.archived_at]),
  );
  const countByConversation = new Map<string, number>();
  for (const row of memberRows ?? []) {
    countByConversation.set(
      row.conversation_id,
      (countByConversation.get(row.conversation_id) ?? 0) + 1,
    );
  }

  const all = (courses ?? []).flatMap((row) => {
    const conversationId = linkByCourse.get(row.id);
    if (!conversationId) return [];
    const archived =
      row.term !== configuredTerm ||
      archiveByConversation.get(conversationId) !== null;
    return [
      {
        ...catalogEntry(row),
        conversationId,
        archived,
        memberCount: countByConversation.get(conversationId) ?? 0,
      },
    ];
  });
  all.sort((left, right) => left.code.localeCompare(right.code));
  return {
    current: all.filter((course) => !course.archived),
    archived: all.filter((course) => course.archived),
  };
}

async function resolveJoinedCourse(
  supabase: SupabaseClient,
  member: CurrentMember,
  courseId: string,
) {
  const { data: membership, error: membershipError } = await supabase
    .from("course_members")
    .select("course_id")
    .eq("course_id", courseId)
    .eq("user_id", member.userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return null;

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, school_id, code, title, term")
    .eq("id", courseId)
    .eq("school_id", member.schoolId)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course) return null;

  const { data: link, error: linkError } = await supabase
    .from("course_conversations")
    .select("conversation_id")
    .eq("course_id", courseId)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("archived_at")
    .eq("id", link.conversation_id)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return null;

  return {
    course: catalogEntry(course),
    conversationId: link.conversation_id,
    archived: conversation.archived_at !== null,
  };
}

async function messageViews(
  supabase: SupabaseClient,
  conversationId: string,
  options: { after?: number; before?: number; limit: number },
) {
  let query = supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", conversationId);
  if (options.after !== undefined) query = query.gt("id", options.after);
  if (options.before !== undefined) query = query.lt("id", options.before);
  const ascending = options.after !== undefined;
  const { data, error } = await query
    .order("id", { ascending })
    .limit(options.limit);
  if (error) throw error;
  const rows = data ?? [];
  const senderIds = Array.from(
    new Set(rows.flatMap((row) => (row.sender_id ? [row.sender_id] : []))),
  );
  const { data: profiles, error: profileError } = senderIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", senderIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.display_name]),
  );
  const messages = rows.map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_id
      ? (names.get(row.sender_id) ?? "成员")
      : "已注销用户",
    body: row.body,
    createdAt: row.created_at,
  }));
  return ascending ? messages : messages.reverse();
}

export async function getCourseRoom(
  member: CurrentMember,
  courseId: string,
): Promise<CourseRoom | null> {
  const supabase = await createClient();
  const access = await resolveJoinedCourse(supabase, member, courseId);
  if (!access) return null;

  const { data: memberRows, error: memberError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", access.conversationId)
    .order("joined_at");
  if (memberError) throw memberError;
  const userIds = (memberRows ?? []).map((row) => row.user_id);
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const members = userIds.map((userId) => {
    const profile = profileById.get(userId);
    return {
      userId,
      displayName: profile?.display_name ?? "成员",
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
  const messages = await messageViews(supabase, access.conversationId, {
    limit: 50,
  });

  return {
    course: {
      ...access.course,
      conversationId: access.conversationId,
      archived: access.archived,
      memberCount: members.length,
    },
    members,
    messages,
    hasOlderMessages: messages.length === 50,
  };
}

export async function getCourseMessagesAfter(
  member: CurrentMember,
  courseId: string,
  after: number,
) {
  const supabase = await createClient();
  const access = await resolveJoinedCourse(supabase, member, courseId);
  if (!access) return null;
  const messages = await messageViews(supabase, access.conversationId, {
    after,
    limit: 200,
  });
  return { messages, hasMore: messages.length === 200 };
}

export async function getCourseMessagesBefore(
  member: CurrentMember,
  courseId: string,
  before: number,
) {
  const supabase = await createClient();
  const access = await resolveJoinedCourse(supabase, member, courseId);
  if (!access) return null;
  const messages = await messageViews(supabase, access.conversationId, {
    before,
    limit: 50,
  });
  return { messages, hasMore: messages.length === 50 };
}
