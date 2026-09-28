import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";

type DashboardHeaderProps = {
  email: string;
  schoolName: string;
  /** 退出登录的 Server Action。由页面传入——组件不决定退出后去哪。 */
  signOutAction: () => Promise<void>;
  /** 只有带平台身份的成员才传，其余人看不到管理入口。 */
  adminHref?: string;
};

/**
 * 大厅顶部工具条。好友、个人资料的入口已经在导航外壳里，这里只留学校与账号信息、
 * 退出登录；管理入口在桌面导航栏里也有，这里只在手机端显示。
 */
export function DashboardHeader({
  email,
  schoolName,
  signOutAction,
  adminHref,
}: DashboardHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-4 py-3 md:px-6">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
          CourseMate
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">
          <span className="font-medium text-ink">{schoolName}</span>
          <span aria-hidden="true" className="mx-2 text-line">
            ·
          </span>
          {email}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {adminHref ? (
          <Link
            className="flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium text-ink transition hover:bg-panel md:hidden"
            href={adminHref}
          >
            <ShieldCheck size={14} strokeWidth={1.75} />
            管理
          </Link>
        ) : null}
        <form action={signOutAction}>
          <button
            className="flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium text-muted transition hover:bg-panel hover:text-ink"
            type="submit"
          >
            <LogOut size={14} strokeWidth={1.75} />
            退出登录
          </button>
        </form>
      </div>
    </header>
  );
}
