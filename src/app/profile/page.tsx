import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { updateProfileAction } from "@/features/profile/actions";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { getOwnProfile } from "@/features/profile/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const profile = await getOwnProfile(member.userId);
  if (!profile) redirect("/onboarding/profile");

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
        <div className="mb-8 flex items-start gap-4">
          {profile.avatarUrl ? (
            // avatar_url 只读；本 Ticket 不开放任意 URL 编辑或上传。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${profile.displayName} 的头像`}
              className="h-16 w-16 rounded-full border border-slate-200 object-cover"
              src={profile.avatarUrl}
            />
          ) : (
            <div
              aria-label="默认头像"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-700"
            >
              {Array.from(profile.displayName)[0] ?? "?"}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Profile
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              个人资料
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              显示名称修改后会同步到没有好友备注的关系中。
            </p>
          </div>
        </div>

        <ProfileForm
          action={updateProfileAction}
          initialProfile={profile}
          submitLabel="保存修改"
        />

        <Link
          className="mt-5 block text-center text-sm font-medium text-indigo-700 hover:text-indigo-950"
          href="/dashboard"
        >
          返回大厅
        </Link>
      </section>
    </main>
  );
}
