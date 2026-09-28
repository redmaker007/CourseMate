"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 「消息与好友」两栏布局：桌面端左栏列表 + 右栏内容。
 * 手机端一次只显示一栏：在 /friends 显示列表，点进去之后只显示右栏内容。
 */
export function InboxShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const onListRoute = usePathname() === "/friends";

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={`w-full shrink-0 border-r border-line md:flex md:w-[300px] md:flex-col ${
          onListRoute ? "flex flex-col" : "hidden"
        }`}
      >
        {list}
      </aside>
      <div
        className={`min-w-0 flex-1 flex-col overflow-y-auto md:flex ${onListRoute ? "hidden" : "flex"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** 右栏页面的标题栏（48px）。手机端带返回列表的按钮。 */
export function InboxPaneHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-card px-3 md:px-4">
      <Link
        aria-label="返回列表"
        className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink md:hidden"
        href="/friends"
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </Link>
      <h1 className="min-w-0 truncate text-sm font-semibold text-ink">{title}</h1>
      {subtitle ? <span className="hidden min-w-0 truncate text-xs text-muted sm:inline">{subtitle}</span> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
