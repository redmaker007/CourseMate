import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { friendMutationAction } from "@/features/friends/actions";
import { CourseMemberRequestPanel } from "@/features/friends/components/friend-discovery";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AddCourseMemberFriendPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const { memberId } = await searchParams;
  if (!memberId || !UUID_PATTERN.test(memberId)) redirect("/friends");

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12">
      <SchoolTestBanner member={member} />
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <Link className="text-sm font-semibold text-indigo-700" href="/friends">
          返回好友页
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-950">向课程成员发送好友申请</h1>
        <p className="mt-2 text-sm text-slate-600">
          这里只提交课程成员 ID，不会公开或猜测对方邮箱。
        </p>
        <CourseMemberRequestPanel
          memberId={memberId}
          mutationAction={friendMutationAction}
        />
      </section>
    </main>
  );
}
