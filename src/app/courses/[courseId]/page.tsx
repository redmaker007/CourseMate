import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { leaveCourseAction } from "@/features/courses/actions";
import { CourseChat } from "@/features/courses/components/course-chat";
import { getCourseRoom } from "@/features/courses/queries";

export const dynamic = "force-dynamic";

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
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link className="text-sm font-semibold text-indigo-700 hover:text-indigo-950" href="/dashboard">
                ← 返回 Dashboard
              </Link>
              <div className="mt-4 flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                  {room.course.code} · {room.course.title}
                </h1>
                {room.course.archived ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    已归档
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {room.course.term} · {room.course.memberCount} 位成员
              </p>
            </div>
            {!room.course.archived ? (
              <form action={leaveAction}>
                <button className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50" type="submit">
                  退出课程
                </button>
              </form>
            ) : null}
          </div>
          {courseAction === "failed" ? (
            <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
              课程操作失败，请刷新后重试。
            </p>
          ) : null}
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <CourseChat
            archived={room.course.archived}
            conversationId={room.course.conversationId}
            courseId={room.course.id}
            currentUserId={member.userId}
            hasOlderMessages={room.hasOlderMessages}
            initialMessages={room.messages}
          />

          <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">课程成员</h2>
            <p className="mt-1 text-xs text-slate-500">成员标识稳定，不展示邮箱。</p>
            <ul className="mt-4 space-y-2">
              {room.members.map((courseMember) => (
                <li className="rounded-xl border border-slate-200 p-3" key={courseMember.userId}>
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {courseMember.displayName}
                  </p>
                  {courseMember.userId !== member.userId ? (
                    <Link
                      className="mt-1 inline-block text-xs font-medium text-indigo-700 hover:text-indigo-950"
                      href={`/friends/add?memberId=${courseMember.userId}`}
                    >
                      添加好友
                    </Link>
                  ) : (
                    <span className="mt-1 block text-xs text-slate-500">我</span>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </main>
  );
}
