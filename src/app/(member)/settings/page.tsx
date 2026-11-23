import { ChevronLeft, LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { AccountDeletionCard } from "@/features/auth/components/account-deletion-card";
import { PasswordCard } from "@/features/auth/components/password-card";
import { requestPasswordCodeAction, setPasswordAction } from "@/features/auth/password-actions";
import { getOwnPasswordStatus } from "@/features/auth/queries";
import { getCurrentMember } from "@/features/auth/session";
import { accountDeletionAction } from "@/features/auth/web-account-deletion-actions";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { LatencyToggle } from "@/features/latency/components/latency-toggle";
import { PushCard } from "@/features/push/components/push-card";
import { InstallCard } from "@/features/pwa/components/install-card";
import { ThemeSelector } from "@/features/theme/components/theme-toggle";
import { serverEnv } from "@/lib/server-env";

export const dynamic = "force-dynamic";

export const metadata = { title: "设置" };

const linkClass = "flex items-center justify-between px-4 py-3 text-sm text-ink hover:bg-panel";

export default async function SettingsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const passwordSet = await getOwnPasswordStatus();

  return (
    <main className="page-enter min-h-full shrink-0 bg-canvas">
      <SchoolTestBanner member={member} />
      <header className="flex items-center gap-1 border-b border-line bg-card px-2 py-3 md:px-4">
        <Link
          aria-label="返回我的"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink"
          href="/profile"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </Link>
        <h1 className="text-lg font-bold text-ink">设置</h1>
      </header>

      <div className="mx-auto w-full max-w-lg space-y-3 px-4 py-5">
        <PasswordCard
          email={member.email}
          passwordSet={passwordSet}
          requestAction={requestPasswordCodeAction}
          setAction={setPasswordAction}
        />

        <section
          aria-labelledby="display-preferences"
          className="space-y-5 rounded-xl border border-line bg-card p-4"
        >
          <h2 className="text-sm font-semibold text-ink" id="display-preferences">
            显示偏好
          </h2>
          <ThemeSelector />
          <LatencyToggle />
        </section>

        <InstallCard />
        {serverEnv.push ? <PushCard publicKey={serverEnv.push.publicKey} /> : null}

        <nav aria-label="帮助与政策" className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          <Link className={linkClass} href="/support">帮助与联系<span className="text-muted">›</span></Link>
          <Link className={linkClass} href="/terms">用户协议与社区规范<span className="text-muted">›</span></Link>
          <Link className={linkClass} href="/privacy">隐私政策<span className="text-muted">›</span></Link>
        </nav>

        <form action={signOutAndReturnToLoginAction}>
          <button
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-card text-sm font-medium text-badge transition hover:bg-badge/10"
            type="submit"
          >
            <LogOut size={15} strokeWidth={1.75} />
            退出登录
          </button>
        </form>

        <AccountDeletionCard action={accountDeletionAction} email={member.email} />
      </div>
    </main>
  );
}
