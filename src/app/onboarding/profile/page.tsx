import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { completeProfileOnboardingAction } from "@/features/profile/actions";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { safeProfileNextPath } from "@/features/profile/profile-navigation";
import { getOwnProfile } from "@/features/profile/queries";

export const dynamic = "force-dynamic";

export default async function ProfileOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  const { next } = await searchParams;
  const destination = safeProfileNextPath(next);
  if (member.onboardingComplete) redirect(destination);

  const profile = await getOwnProfile(member.userId);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            CourseMate Profile
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            先取一个显示名称
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            这是同学在课程和好友页面看到的称呼，之后可以随时修改。
          </p>
        </div>

        <ProfileForm
          action={completeProfileOnboardingAction}
          initialProfile={{
            displayName: profile?.displayName ?? "",
            major: profile?.major ?? null,
            gradYear: profile?.gradYear ?? null,
          }}
          nextPath={destination}
          submitLabel="保存并进入 CourseMate"
        />

        <form action={signOutAndReturnToLoginAction} className="mt-5">
          <button
            className="w-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
            type="submit"
          >
            退出登录
          </button>
        </form>
      </section>
    </main>
  );
}
