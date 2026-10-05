import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
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

  // 三路数据互不依赖，同时发出：总耗时取决于最慢的一路，而不是三路相加。
  // 各路自己处理失败并给出降级值，一路失败不会拖垮整页。
  // 平台身份读不到时返回 null，只是不显示管理入口，不影响大厅本身。
  // 私聊未读数由导航外壳显示，这里不再单独读取。
  const [
    platformRole,
    schoolName,
    { courses, searchResults, unavailable: courseDataUnavailable },
  ] = await Promise.all([
    getPlatformRole(),
    loadSchoolName(member.schoolId),
    loadCourseData(member, courseQuery),
  ]);

  return (
    <div className="page-enter flex min-h-full shrink-0 flex-col bg-canvas md:h-full">
      <SchoolTestBanner member={member} />
      <DashboardHeader
        adminHref={platformRole ? "/admin" : undefined}
        email={member.email}
        schoolName={schoolName}
        signOutAction={signOutAndReturnToLoginAction}
      />

      <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
        {/* 左侧搜课面板；手机端排在课程上方 */}
        <aside className="border-b border-line bg-panel md:w-[clamp(300px,28vw,380px)] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
          <CourseSearch query={courseQuery} results={searchResults} />
        </aside>

        <main className="flex-1 space-y-6 px-4 py-5 md:overflow-y-auto md:px-6">
          {signout === "failed" ? (
            <div className="rounded-xl border border-badge/30 bg-badge/10 px-4 py-3 text-sm text-badge">
              退出登录失败，你仍处于登录状态。请稍后重试。
            </div>
          ) : null}

          {courseAction === "failed" || courseAction === "invalid" ? (
            <div className="rounded-xl border border-badge/30 bg-badge/10 px-4 py-3 text-sm text-badge">
              课程操作失败，请刷新后重试。
            </div>
          ) : null}

          {courseDataUnavailable ? (
            <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
              课程数据暂时不可用，请稍后刷新。
            </div>
          ) : null}

          <Section
            badge={`${courses.current.length} 门`}
            description="加入课程后会自动进入对应的课程群。"
            title="本学期课程"
          >
            {courses.current.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {courses.current.map((course, index) => (
                  <CourseCard colorIndex={index} course={course} key={course.id} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-brand/40 bg-brand-soft px-4 py-4 text-center text-sm text-ink">
                <span className="md:hidden">↑ 在上方搜索</span>
                <span className="hidden md:inline">← 在左侧搜索</span>
                你本学期的课程，加入对应的班级群聊
              </p>
            )}
          </Section>

          {courses.archived.length ? (
            <Section
              badge="只读"
              description="已结束学期不再主动显示在当前课程中，但历史消息和成员仍可查看。"
              title="往期课程"
            >
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {courses.archived.map((course) => (
                  <CourseCard course={course} key={course.id} />
                ))}
              </ul>
            </Section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
