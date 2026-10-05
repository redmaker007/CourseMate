"use client";

import { CalendarDays, MessageSquare, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { formatBadge, navSectionFor, type NavSection } from "@/features/shell/navigation";

const TABS: { label: string; href: string; section: NavSection; icon: typeof User }[] = [
  { label: "课表", href: "/dashboard", section: "dashboard", icon: CalendarDays },
  { label: "消息", href: "/friends", section: "messages", icon: MessageSquare },
  { label: "我", href: "/profile", section: "profile", icon: User },
];

/** 手机端（宽度 < 768px）底部标签栏。 */
export function MobileTabBar({ directUnread }: { directUnread: number }) {
  const section = navSectionFor(usePathname());

  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--tab-bar-height)] items-stretch border-t border-line bg-bar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map(({ label, href, section: tabSection, icon: Icon }) => {
        const active = section === tabSection;
        const badge = tabSection === "messages" ? directUnread : 0;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 ${
              active ? "text-brand" : "text-muted"
            }`}
            href={href}
            key={href}
          >
            <span className="relative">
              <Icon size={22} strokeWidth={1.75} />
              {badge > 0 ? (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-[10px] font-bold leading-none text-white">
                  {formatBadge(badge)}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
