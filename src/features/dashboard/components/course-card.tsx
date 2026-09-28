import { MessageCircle, Users } from "lucide-react";
import Link from "next/link";

import type { CourseListItem } from "@/features/courses/queries";
import { courseColor } from "@/features/shell/navigation";

type CourseCardProps = {
  course: CourseListItem;
  /**
   * 当前学期课程的顺序号，用来取课程色，和左侧导航栏里的课程方块同色。
   * 往期课程不传，显示为灰色。
   */
  colorIndex?: number;
};

export function CourseCard({ course, colorIndex }: CourseCardProps) {
  const color = colorIndex === undefined ? "var(--muted)" : courseColor(colorIndex);

  return (
    <li
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-3.5"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-base font-bold" style={{ color }}>
            {course.code}
          </span>
          <span className="shrink-0 text-xs text-muted">{course.term}</span>
          {course.archived ? (
            <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
              已归档
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-ink">{course.title}</p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="flex items-center gap-1 text-xs text-muted">
          <Users size={12} strokeWidth={1.75} />
          {course.memberCount} 位同学
        </span>
        <Link
          className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition hover:opacity-80"
          href={`/courses/${course.id}`}
        >
          <MessageCircle size={12} strokeWidth={1.75} />
          {course.archived ? "查看记录" : "进入群聊"}
        </Link>
      </div>
    </li>
  );
}
