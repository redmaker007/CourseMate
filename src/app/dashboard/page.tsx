import Link from "next/link";
import { redirect } from "next/navigation";

import { getEnabledSchools } from "@/features/auth/queries";
import { getCurrentMember } from "@/features/auth/session";
import { CourseSearch } from "@/features/courses/components/course-search";
import {
  getDashboardCourses,
  searchAvailableCourses,
} from "@/features/courses/queries";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { CourseCard } from "@/features/dashboard/components/course-card";
import { DashboardHeader } from "@/features/dashboard/components/dashboard-header";
import { EmptySlot } from "@/features/dashboard/components/empty-slot";
import { Section } from "@/features/dashboard/components/section";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // proxy 已经挡过一次，这里再挡一次：不能只信 proxy，页面自己也要重新授权。
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const { signout, q, courseAction } = await searchParams;
  const courseQuery = typeof q === "string" ? q.trim() : "";

  let schoolName = member.schoolId;
  try {
    const school = (await getEnabledSchools()).find(
      (candidate) => candidate.id === member.schoolId,
    );
    if (school) schoolName = school.nameZh;
  } catch {
    // 学校名只是展示用，取不到就退回学校 ID，不该拦住整个页面。
  }

  let courses = { current: [], archived: [] } as Awaited<
    ReturnType<typeof getDashboardCourses>
  >;
  let searchResults = [] as Awaited<ReturnType<typeof searchAvailableCourses>>;
  let courseDataUnavailable = false;
  let directUnread = 0;
  try {
    [courses, searchResults] = await Promise.all([
      getDashboardCourses(member),
      courseQuery
        ? searchAvailableCourses(member, courseQuery)
        : Promise.resolve([]),
    ]);
  } catch {
    courseDataUnavailable = true;
  }

  try {
    const messageService = await createProductionDirectMessageService();
    const unreadResult = await messageService.getUnreadCounts();
    if (unreadResult.status === "loaded") {
      directUnread = unreadResult.counts.visible;
    }
  } catch {
    // Unread is a secondary hint; the rest of Dashboard remains usable.
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader
        email={member.email}
        schoolName={schoolName}
        signOutAction={signOutAndReturnToLoginAction}
      />

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8">
        <Link
          className="flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-semibold text-indigo-900"
          href="/friends"
        >
          <span>私聊消息</span>
          <span>{directUnread > 0 ? `${directUnread} 条私聊未读` : "查看好友"}</span>
        </Link>
        {signout === "failed" ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
            退出登录失败，你仍处于登录状态。请稍后重试。
          </div>
        ) : null}

        {courseAction === "failed" || courseAction === "invalid" ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
            课程操作失败，请刷新后重试。
          </div>
        ) : null}

        {courseDataUnavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            课程数据暂时不可用，请稍后刷新。
          </div>
        ) : null}

        <CourseSearch query={courseQuery} results={searchResults} />

        <Section
          badge="当前学期"
          description="加入课程后会自动进入对应的课程群。"
          title="我的课程"
        >
          <ul className="space-y-2.5">
            {courses.current.length ? (
              courses.current.map((course) => (
                <CourseCard course={course} key={course.id} />
              ))
            ) : (
              <li className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-600">
                还没有加入当前学期的课程，可以从上方搜索。
              </li>
            )}
          </ul>
        </Section>

        {courses.archived.length ? (
          <Section
            badge="只读"
            description="已结束学期不再主动显示在当前课程中，但历史消息和成员仍可查看。"
            title="归档课程"
          >
            <ul className="space-y-2.5">
              {courses.archived.map((course) => (
                <CourseCard course={course} key={course.id} />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          badge="P1"
          description="按课程和空闲时间匹配同校同学。"
          title="学习搭子"
        >
          <EmptySlot
            hint="属于 P1 范围，会在 MVP 稳定之后开始做。"
            title="尚未开始开发"
          />
        </Section>

        <Section
          badge="P1"
          description="上传并共享课程笔记。"
          title="笔记共享"
        >
          <EmptySlot
            hint="需要先补齐举报与内容审核机制才能上线。"
            title="尚未开始开发"
          />
        </Section>
      </main>
    </div>
  );
}
