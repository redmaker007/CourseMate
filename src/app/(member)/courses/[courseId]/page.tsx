import { ChevronLeft, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/ui/chat";
import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { getCurrentMember } from "@/features/auth/session";
import { leaveCourseAction } from "@/features/courses/actions";
import { CourseChat } from "@/features/courses/components/course-chat";
import {
  getCourseRoom,
  type CourseMemberView,
} from "@/features/courses/queries";

export const dynamic = "force-dynamic";

function MemberRelationshipAction({ member }: { member: CourseMemberView }) {
  if (member.relationshipStatus === "self") {
    return <span className="mt-1 block text-xs text-muted">我</span>;
  }
  if (member.relationshipStatus === "unavailable") {
    return <span className="mt-1 block text-xs text-warn">关系状态暂不可用</span>;
  }
  if (member.relationshipStatus === "friend") {
    if (!member.conversationId) {
      return <span className="mt-1 block text-xs text-badge">好友数据异常</span>;
    }
    return (
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="text-muted">已是好友</span>
        <Link className="font-medium text-accent hover:opacity-80" href={`/messages/${member.conversationId}`}>
          发消息
        </Link>
      </div>
    );
  }
  if (member.restrictionStatus === "blocked") {
    return <span className="mt-1 block text-xs text-muted">当前无法添加</span>;
  }
  if (member.relationshipStatus === "outgoing_request") {
    return <span className="mt-1 block text-xs text-muted">申请已发送</span>;
  }
  if (member.relationshipStatus === "incoming_request") {
    return (
      <Link className="mt-1 inline-block text-xs font-medium text-accent hover:opacity-80" href="/friends">
        处理申请
      </Link>
    );
  }
  return (
    <Link
      className="mt-1 inline-block text-xs font-medium text-accent hover:opacity-80"
      href={`/friends/add?memberId=${member.userId}`}
    >
      添加好友
    </Link>
  );
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ courseAction?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const { courseId } = await params;
  const room = await getCourseRoom(member, courseId);
  if (!room) notFound();
  const { courseAction } = await searchParams;
  const leaveAction = leaveCourseAction.bind(null, room.course.id);

  return (
    <div className="page-enter flex h-full min-h-0 flex-col bg-canvas">
      <SchoolTestBanner member={member} />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-card px-3 md:px-4">
        <Link
          aria-label="返回大厅"
          className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink md:hidden"
          href="/dashboard"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </Link>
        <h1 className="min-w-0 truncate text-sm font-semibold text-ink">
          {room.course.code}
          <span className="ml-2 font-normal text-muted">{room.course.title}</span>
        </h1>
        {room.course.archived ? (
          <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
            已归档
          </span>
        ) : null}
        <span className="hidden shrink-0 text-xs text-muted sm:inline">
          {room.course.term} · {room.course.memberCount} 位成员
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* 窄屏下成员列表默认收起，点这里展开；用纯 CSS 实现，成员列表只渲染一份 */}
          <label
            className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-panel hover:text-ink lg:hidden"
            htmlFor="course-members-toggle"
          >
            <Users size={15} strokeWidth={1.75} />
            成员
          </label>
          {!room.course.archived ? (
            <form action={leaveAction}>
              <button
                className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-badge hover:bg-badge/10"
                type="submit"
              >
                <LogOut size={14} strokeWidth={1.75} />
                退出课程
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {courseAction === "failed" ? (
        <p className="shrink-0 border-b border-badge/30 bg-badge/10 px-4 py-2 text-sm text-badge">
          课程操作失败，请刷新后重试。
        </p>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <CourseChat
          archived={room.course.archived}
          conversationId={room.course.conversationId}
          courseId={room.course.id}
          currentUserId={member.userId}
          hasOlderMessages={room.hasOlderMessages}
          initialMessages={room.messages}
        />

        <input className="peer sr-only" id="course-members-toggle" type="checkbox" />
        <aside className="absolute inset-y-0 right-0 z-20 hidden w-64 flex-col overflow-y-auto border-l border-line bg-panel shadow-xl peer-checked:flex lg:static lg:flex lg:w-60 lg:shadow-none">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <h2 className="text-sm font-semibold text-ink">同学 · {room.members.length}</h2>
            <label
              className="cursor-pointer text-xs text-muted hover:text-ink lg:hidden"
              htmlFor="course-members-toggle"
            >
              收起
            </label>
          </div>
          <p className="px-3 pt-2 text-[11px] text-muted">成员标识稳定，不展示邮箱。</p>
          <ul className="space-y-0.5 p-2">
            {room.members.map((courseMember) => (
              <li className="flex items-start gap-2 rounded-md px-1.5 py-1.5" key={courseMember.userId}>
                <Avatar id={courseMember.userId} name={courseMember.displayName} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">
                    {courseMember.displayName}
                  </p>
                  <MemberRelationshipAction member={courseMember} />
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
