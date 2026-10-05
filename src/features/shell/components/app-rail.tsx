"use client";

import { CalendarDays, MessageSquare, Plus, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import {
  courseColor,
  formatBadge,
  navSectionFor,
  shortCourseCode,
} from "@/features/shell/navigation";
import type { ShellData } from "@/features/shell/queries";

type RailTileProps = {
  href: string;
  label: string;
  selected?: boolean;
  badge?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

function RailTile({ href, label, selected, badge, className = "", style, children }: RailTileProps) {
  return (
    <Link
      aria-current={selected ? "page" : undefined}
      aria-label={label}
      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-[border-radius] duration-150 ease-out hover:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        selected ? "outline-2 outline-offset-2 outline-brand" : ""
      } ${className}`}
      href={href}
      style={style}
      title={label}
    >
      {selected ? (
        <span aria-hidden="true" className="absolute -left-3 h-6 w-1 rounded-r-full bg-brand" />
      ) : null}
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-[10px] font-bold leading-none text-white">
          {formatBadge(badge)}
        </span>
      ) : null}
    </Link>
  );
}

function RailLabelIcon({ icon, text, active }: { icon: ReactNode; text: string; active: boolean }) {
  return (
    <span className={`flex flex-col items-center gap-0.5 ${active ? "text-brand" : "text-muted"}`}>
      {icon}
      <span className="text-[10px] leading-none">{text}</span>
    </span>
  );
}

/** 桌面端左侧导航栏（72px）。手机端由 MobileTabBar 代替。 */
export function AppRail({ courses, directUnread, showAdmin }: ShellData) {
  const pathname = usePathname();
  const section = navSectionFor(pathname);

  return (
    <nav
      aria-label="主导航"
      className="flex h-full w-[var(--rail-width)] flex-col items-center gap-2 overflow-y-auto border-r border-line bg-rail py-3"
    >
      <Link
        aria-label="CourseMate 首页"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-sm font-bold text-white"
        href="/dashboard"
      >
        CM
      </Link>

      <div aria-hidden="true" className="my-1 h-px w-8 bg-line" />

      <RailTile className="bg-panel" href="/dashboard" label="课表" selected={section === "dashboard"}>
        <RailLabelIcon
          active={section === "dashboard"}
          icon={<CalendarDays size={20} strokeWidth={1.75} />}
          text="课表"
        />
      </RailTile>
      <RailTile
        badge={directUnread}
        className="bg-panel"
        href="/friends"
        label="消息"
        selected={section === "messages"}
      >
        <RailLabelIcon
          active={section === "messages"}
          icon={<MessageSquare size={20} strokeWidth={1.75} />}
          text="消息"
        />
      </RailTile>

      <div aria-hidden="true" className="my-1 h-px w-8 bg-line" />

      {courses.map((course, index) => (
        <RailTile
          href={`/courses/${course.id}`}
          key={course.id}
          label={`${course.code} ${course.title}`}
          selected={pathname === `/courses/${course.id}`}
          style={{ background: courseColor(index) }}
        >
          <span className="px-1 text-center text-[10px] font-bold leading-tight text-white">
            {shortCourseCode(course.code)}
          </span>
        </RailTile>
      ))}

      <RailTile className="border-[1.5px] border-dashed border-line" href="/dashboard" label="添加课程">
        <Plus className="text-muted" size={18} strokeWidth={1.75} />
      </RailTile>

      <div className="flex-1" />

      {showAdmin ? (
        <Link
          aria-label="管理后台"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-panel hover:text-ink"
          href="/admin"
          title="管理后台"
        >
          <ShieldCheck size={18} strokeWidth={1.75} />
        </Link>
      ) : null}

      <Link
        aria-current={section === "profile" ? "page" : undefined}
        aria-label="我的"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white ${
          section === "profile" ? "bg-brand-hover" : "bg-brand"
        }`}
        href="/profile"
        title="我的"
      >
        <User size={18} strokeWidth={1.75} />
      </Link>
    </nav>
  );
}
