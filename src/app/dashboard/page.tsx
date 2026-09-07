import { redirect } from "next/navigation";

import { getEnabledSchools } from "@/features/auth/queries";
import { getCurrentMember } from "@/features/auth/session";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { CourseCard } from "@/features/dashboard/components/course-card";
import { DashboardHeader } from "@/features/dashboard/components/dashboard-header";
import { EmptySlot } from "@/features/dashboard/components/empty-slot";
import { PlaceholderNotice } from "@/features/dashboard/components/placeholder-notice";
import { Section } from "@/features/dashboard/components/section";
import { PLACEHOLDER_COURSES } from "@/features/dashboard/placeholder-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // proxy 已经挡过一次，这里再挡一次：不能只信 proxy，页面自己也要重新授权。
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  const { signout } = await searchParams;

  let schoolName = member.schoolId;
  try {
    const school = (await getEnabledSchools()).find(
      (candidate) => candidate.id === member.schoolId,
    );
    if (school) schoolName = school.nameZh;
  } catch {
    // 学校名只是展示用，取不到就退回学校 ID，不该拦住整个页面。
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader
        email={member.email}
        schoolName={schoolName}
        signOutAction={signOutAndReturnToLoginAction}
      />

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8">
        {signout === "failed" ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
            退出登录失败，你仍处于登录状态。请稍后重试。
          </div>
        ) : null}

        <PlaceholderNotice />

        <Section
          badge="占位数据"
          description="加入课程后会自动进入对应的课程群。"
          title="我的课程"
          action={
            <button
              className="cursor-not-allowed rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
              disabled
              title="课程功能尚未接入"
              type="button"
            >
              加入课程
            </button>
          }
        >
          <ul className="space-y-2.5">
            {PLACEHOLDER_COURSES.map((course) => (
              <CourseCard course={course} key={course.id} />
            ))}
          </ul>
        </Section>

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
