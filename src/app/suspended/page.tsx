import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountDeletionCard } from "@/features/auth/components/account-deletion-card";
import { currentSessionSuspended } from "@/features/auth/session";
import { accountDeletionAction } from "@/features/auth/web-account-deletion-actions";
import { signOutAndReturnToLoginAction } from "@/features/dashboard/actions";
import { ContactEmail } from "@/features/legal/components/legal-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "账号已停用" };

/**
 * 停用账号的落点（202611230001）。停用成员的会话仍然有效，所以 proxy 会放行到这里；
 * 主应用页面读不到成员（getCurrentMember 返回 null）会先去 /login，再由登录页带到这里。
 * 这里只提供：说明、联系渠道、退出登录、永久注销。
 */
export default async function SuspendedPage() {
  if (!(await currentSessionSuspended())) redirect("/login");
  const { data } = await (await createClient()).auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <section className="w-full max-w-[480px] space-y-5 rounded-3xl bg-card p-7 shadow-xl shadow-black/5 sm:p-9">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-brand">CourseMate</p>
          <h1 className="text-2xl font-bold text-ink">账号已停用</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            你的账号因违反
            <Link className="font-medium text-accent hover:opacity-80" href="/terms">《用户协议与社区规范》</Link>
            已被平台管理员停用，暂时不能使用 CourseMate。你之前发的内容可能已被删除。
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            如有异议，请发邮件至 <ContactEmail /> 申诉。
          </p>
        </div>

        <form action={signOutAndReturnToLoginAction}>
          <button
            className="h-11 w-full rounded-xl border border-line bg-canvas text-sm font-medium text-ink hover:bg-panel"
            type="submit"
          >
            退出登录
          </button>
        </form>

        <AccountDeletionCard action={accountDeletionAction} email={email} />
      </section>
    </main>
  );
}
