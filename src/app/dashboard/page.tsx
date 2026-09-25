import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getPlatformRole } from "@/features/admin/queries";
import { getEnabledSchools } from "@/features/auth/queries";
import { getCurrentMember, type CurrentMember } from "@/features/auth/session";
import { CourseSearch } from "@/features/courses/components/course-search";
import {
  getDashboardCourses,
  searchAvailableCourses,
} from "@/features/courses/queries";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { CourseCard } from "@/features/dashboard/components/course-card";
import { DashboardHeader } from "@/features/dashboard/components/dashboard-header";
import { Section } from "@/features/dashboard/components/section";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";

export const dynamic = "force-dynamic";

// 学校名只是展示用，取不到就退回学校 ID，不该拦住整个页面。
async function loadSchoolName(schoolId: string) {
  try {
    const school = (await getEnabledSchools()).find(
      (candidate) => candidate.id === schoolId,
    );
    return school ? school.nameZh : schoolId;
  } catch {
    return schoolId;
  }
}

async function loadCourseData(member: CurrentMember, courseQuery: string) {
  try {
    const [courses, searchResults] = await Promise.all([
      getDashboardCourses(member),
      courseQuery
        ? searchAvailableCourses(member, courseQuery)
        : Promise.resolve([]),
    ]);
    return { courses, searchResults, unavailable: false };
  } catch {
    return {
      courses: { current: [], archived: [] } as Awaited<
        ReturnType<typeof getDashboardCourses>
      >,
      searchResults: [] as Awaited<ReturnType<typeof searchAvailableCourses>>,
      unavailable: true,
    };
  }
}

// 未读数只是次要提示，取不到时大厅其余部分照常可用。
async function loadDirectUnread() {
  try {
    const messageService = await createProductionDirectMessageService();
    const unreadResult = await messageService.getUnreadCounts();
    return unreadResult.status === "loaded" ? unreadResult.counts.visible : 0;
  } catch {
    return 0;
  }
}

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

  // 四路数据互不依赖，同时发出：总耗时取决于最慢的一路，而不是四路相加。
  // 各路自己处理失败并给出降级值，一路失败不会拖垮整页。
  // 平台身份读不到时返回 null，只是不显示管理入口，不影响大厅本身。
  const [
    platformRole,
    schoolName,
    { courses, searchResults, unavailable: courseDataUnavailable },
    directUnread,
  ] = await Promise.all([
    getPlatformRole(),
    loadSchoolName(member.schoolId),
    loadCourseData(member, courseQuery),
    loadDirectUnread(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <SchoolTestBanner member={member} />
      <DashboardHeader
        adminHref={platformRole ? "/admin" : undefined}
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

      </main>
    </div>
  );
}
