import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { friendMutationAction } from "@/features/friends/actions";
import { CourseMemberRequestPanel } from "@/features/friends/components/friend-discovery";
import { InboxPaneHeader } from "@/features/friends/components/inbox-shell";

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
    <>
      <SchoolTestBanner member={member} />
      <InboxPaneHeader title="向课程成员发送好友申请" />
      <section className="mx-auto w-full max-w-lg px-4 py-5 md:px-6">
        <p className="text-sm text-muted">
          这里只提交课程成员 ID，不会公开或猜测对方邮箱。
        </p>
        <CourseMemberRequestPanel
          memberId={memberId}
          mutationAction={friendMutationAction}
        />
      </section>
    </>
  );
}
