import { Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Avatar } from "@/components/ui/chat";
import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { getCurrentMember } from "@/features/auth/session";
import { updateProfileAction } from "@/features/profile/actions";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { getOwnProfile } from "@/features/profile/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "我的" };

export default async function ProfilePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const profile = await getOwnProfile(member.userId);
  if (!profile) redirect("/onboarding/profile");

  return (
    <main className="page-enter min-h-full shrink-0 bg-canvas">
      <SchoolTestBanner member={member} />
      <header className="border-b border-line bg-card px-4 py-3 md:px-6">
        <h1 className="text-lg font-bold text-ink">我的</h1>
      </header>

      <div className="mx-auto w-full max-w-lg space-y-3 px-4 py-5">
        <section className="flex items-center gap-4 rounded-xl border border-line bg-card p-4">
          {profile.avatarUrl ? (
            // avatar_url 只读；本 Ticket 不开放任意 URL 编辑或上传。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${profile.displayName} 的头像`}
              className="h-16 w-16 rounded-md border border-line object-cover"
              src={profile.avatarUrl}
            />
          ) : (
            <div aria-label="默认头像">
              <Avatar id={member.userId} name={profile.displayName} size={64} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink">{profile.displayName}</p>
            <p className="truncate text-sm text-muted">{member.email}</p>
          </div>
        </section>

        <section
          aria-labelledby="profile-info"
          className="rounded-xl border border-line bg-card p-4"
        >
          <h2 className="text-sm font-semibold text-ink" id="profile-info">
            个人信息
          </h2>
          <p className="mb-4 mt-0.5 text-xs text-muted">
            显示名称修改后会同步到没有好友备注的关系中。
          </p>
          <ProfileForm
            action={updateProfileAction}
            initialProfile={profile}
            submitLabel="保存修改"
          />
        </section>

        <Link
          className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink hover:bg-panel"
          href="/settings"
        >
          <span className="flex items-center gap-2">
            <Settings size={16} strokeWidth={1.75} />
            设置
          </span>
          <span className="text-xs text-muted">密码、通知、隐私、退出与注销 ›</span>
        </Link>
      </div>
    </main>
  );
}
