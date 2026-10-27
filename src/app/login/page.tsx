import { redirect } from "next/navigation";

import {
  requestEmailCodeAction,
  verifyEmailCodeAction,
} from "@/features/auth/actions";
import { LoginMethods } from "@/features/auth/components/login-methods";
import { signInWithPasswordAction } from "@/features/auth/password-actions";
import { getEnabledSchools, type EnabledSchool } from "@/features/auth/queries";
import {
  currentSessionNeedsReverification,
  getCurrentMember,
} from "@/features/auth/session";
import { safeRelativePath } from "@/lib/safe-relative-path";

export const dynamic = "force-dynamic";

/**
 * 只接受站内相对路径，挡掉 //evil.com 和 https://evil.com 这类开放重定向。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
  const destination = safeRelativePath(next);

  // 验证码校验成功后，Server Action 会让这个页面重新渲染，那时会话已经建立，
  // 于是从这里跳进大厅。落点由页面决定，认证模块只负责返回登录结果。
  const member = await getCurrentMember();
  if (member?.onboardingComplete) redirect(destination);
  if (member) {
    redirect(
      `/onboarding/profile?next=${encodeURIComponent(destination)}`,
    );
  }

  const reverificationRequired = await currentSessionNeedsReverification();
  let schools: EnabledSchool[] = [];
  let schoolsUnavailable = false;

  try {
    schools = await getEnabledSchools();
  } catch {
    schoolsUnavailable = true;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <section className="w-full max-w-[480px] rounded-3xl bg-card p-7 shadow-xl shadow-black/5 sm:p-9">
        <div className="mb-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-brand">
            CourseMate
          </p>
          <h1 className="text-[28px] font-bold leading-9 text-ink">
            使用学校邮箱登录
          </h1>
          <p className="mt-2 text-sm text-muted">
            用学校邮箱和密码登录；第一次使用请选验证码登录。
          </p>
        </div>

        {schoolsUnavailable || schools.length === 0 ? (
          <p className="mb-5 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
            学校列表暂时不可用，请稍后刷新重试。
          </p>
        ) : null}

        <LoginMethods
          passwordAction={signInWithPasswordAction}
          requestAction={requestEmailCodeAction}
          reverificationRequired={reverificationRequired}
          schools={schools}
          verifyAction={verifyEmailCodeAction}
        />
      </section>
    </main>
  );
}
