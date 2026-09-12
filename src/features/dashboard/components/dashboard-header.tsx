import Link from "next/link";

type DashboardHeaderProps = {
  email: string;
  schoolName: string;
  /** 退出登录的 Server Action。由页面传入——组件不决定退出后去哪。 */
  signOutAction: () => Promise<void>;
  /** 只有带平台身份的成员才传，其余人看不到管理入口。 */
  adminHref?: string;
};

export function DashboardHeader({
  email,
  schoolName,
  signOutAction,
  adminHref,
}: DashboardHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            CourseMate
          </p>
          <p className="mt-1 truncate text-sm text-slate-600">
            <span className="font-medium text-slate-900">{schoolName}</span>
            <span aria-hidden="true" className="mx-2 text-slate-300">
              ·
            </span>
            {email}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {adminHref ? (
            <Link
              className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
              href={adminHref}
            >
              管理
            </Link>
          ) : null}
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            href="/friends"
          >
            好友
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            href="/profile"
          >
            个人资料
          </Link>
          <form action={signOutAction}>
            <button
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              type="submit"
            >
              退出登录
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
