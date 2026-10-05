import "server-only";

import { cache } from "react";

import type { CurrentMember } from "@/features/auth/session";
import type { CourseMemberRelationshipSummary } from "@/features/friends/friendship-service";
import {
  createSupabaseFriendBackend,
  type FriendshipRpcClient,
} from "@/features/friends/supabase-friend-backend";
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
  relationshipStatus:
    | "self"
    | "unavailable"
    | "none"
    | "outgoing_request"
    | "incoming_request"
    | "friend";
  restrictionStatus: "none" | "blocked" | null;
  sendStatus: "allowed" | "blocked" | "readonly" | null;
  conversationId: string | null;
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

async function loadDashboardCourses(
  member: CurrentMember,
): Promise<{ current: CourseListItem[]; archived: CourseListItem[] }> {
  const supabase = await createClient();
  // 当前学期、我的课程、会话关联、归档与成员数四轮串行请求合并成一次数据库调用，
  // 见 202610050001_dashboard_courses_rpc.sql。函数按调用者的 RLS 读取，可见范围不变。
  const { data, error } = await supabase.rpc("get_dashboard_courses", {
    target_school: member.schoolId,
  });
  if (error) throw error;

  const all = (data ?? []).map((row) => ({
    ...catalogEntry({
      id: row.course_id,
      school_id: row.school_id,
      code: row.code,
      title: row.title,
      term: row.term,
    }),
    conversationId: row.conversation_id,
    archived: row.archived,
    memberCount: row.member_count,
  }));
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
  // 前三个查询互不依赖，同时发出；会话要等到 link 才知道查哪一行，放在后面。
  // 判断顺序与原来逐个查询时一致：先看成员身份，再看课程，再看会话关联。
  const [membershipResult, courseResult, linkResult] = await Promise.all([
    supabase
      .from("course_members")
      .select("course_id")
      .eq("course_id", courseId)
      .eq("user_id", member.userId)
      .maybeSingle(),
    supabase
      .from("courses")
      .select("id, school_id, code, title, term")
      .eq("id", courseId)
      .eq("school_id", member.schoolId)
      .maybeSingle(),
    supabase
      .from("course_conversations")
      .select("conversation_id")
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (membershipResult.error) throw membershipResult.error;
  if (!membershipResult.data) return null;
  if (courseResult.error) throw courseResult.error;
  const course = courseResult.data;
  if (!course) return null;
  if (linkResult.error) throw linkResult.error;
  const link = linkResult.data;
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
  options: { after?: string; before?: string; limit: number },
) {
  let query = supabase
    .from("messages")
    .select("id, sender_id, body, created_at, client_message_id")
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
    id: String(row.id),
    clientMessageId: row.client_message_id,
    senderId: row.sender_id,
    senderName: row.sender_id
      ? (names.get(row.sender_id) ?? "成员")
      : "已注销用户",
    body: row.body,
    createdAt: row.created_at,
  }));
  return ascending ? messages : messages.reverse();
}

/** get_course_room 返回的 jsonb 结构，见 202610050002_course_room_rpc.sql。 */
type CourseRoomPayload = {
  course: { id: string; school_id: string; code: string; title: string; term: string };
  conversation_id: string;
  archived: boolean;
  members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
  messages: {
    id: number | string;
    sender_id: string | null;
    sender_name: string | null;
    body: string;
    created_at: string;
    client_message_id: string | null;
  }[];
};

const ROOM_MESSAGE_LIMIT = 50;

export async function getCourseRoom(
  member: CurrentMember,
  courseId: string,
): Promise<CourseRoom | null> {
  const supabase = await createClient();
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as FriendshipRpcClient["rpc"];
  // 访问校验、课程、会话归档、名单（含昵称）、最近消息在数据库里一次取完，
  // 见 202610050002_course_room_rpc.sql；好友关系摘要自己校验成员身份，与它同时发出。
  const [roomResult, relationships] = await Promise.all([
    supabase.rpc("get_course_room", {
      target_course: courseId,
      target_school: member.schoolId,
      message_limit: ROOM_MESSAGE_LIMIT,
    }),
    (async (): Promise<CourseMemberRelationshipSummary[] | null> => {
      try {
        return await createSupabaseFriendBackend({ rpc: invokeRpc })
          .listCourseMemberRelationships(courseId);
      } catch {
        // 课程主体仍可查看，关系入口安全降级。
        return null;
      }
    })(),
  ]);
  if (roomResult.error) throw roomResult.error;
  // 不是成员、课程不在当前学校、没有会话关联或会话读不到，都返回 null。
  if (!roomResult.data) return null;
  const room = roomResult.data as unknown as CourseRoomPayload;

  const relationshipById = new Map(
    (relationships ?? []).map((relationship) => [relationship.memberId, relationship]),
  );
  const members = room.members.map((row) => {
    const userId = row.user_id;
    const relationship = relationshipById.get(userId);
    const relationshipUnavailable = relationships === null || (!relationship && userId !== member.userId);
    return {
      userId,
      displayName: row.display_name ?? "成员",
      avatarUrl: row.avatar_url ?? null,
      relationshipStatus: userId === member.userId
        ? "self" as const
        : relationshipUnavailable
          ? "unavailable" as const
          : relationship!.relationshipStatus,
      restrictionStatus: relationshipUnavailable || userId === member.userId
        ? null
        : relationship!.restrictionStatus,
      sendStatus: relationshipUnavailable || userId === member.userId
        ? null
        : relationship!.sendStatus,
      conversationId: relationshipUnavailable || userId === member.userId
        ? null
        : relationship!.conversationId,
    };
  });
  const messages = room.messages.map((row) => ({
    id: String(row.id),
    clientMessageId: row.client_message_id,
    senderId: row.sender_id,
    senderName: row.sender_id ? (row.sender_name ?? "成员") : "已注销用户",
    body: row.body,
    createdAt: row.created_at,
  }));

  return {
    course: {
      ...catalogEntry(room.course),
      conversationId: room.conversation_id,
      archived: room.archived,
      memberCount: members.length,
    },
    members,
    messages,
    hasOlderMessages: messages.length === ROOM_MESSAGE_LIMIT,
  };
}

export async function getCourseMessagesAfter(
  member: CurrentMember,
  courseId: string,
  after: string,
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
  before: string,
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

/**
 * 当前成员已加入的课程，分当前学期与归档。同一次请求里导航外壳和大厅页都会读，
 * 用 React cache 只查一次（layout 与页面拿到的是同一个 member 对象）。
 */
export const getDashboardCourses = cache(loadDashboardCourses);
