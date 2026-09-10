import Link from "next/link";

import type { CourseListItem } from "@/features/courses/queries";

type CourseCardProps = {
  course: CourseListItem;
};

export function CourseCard({ course }: CourseCardProps) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3.5 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-slate-950">{course.code}</span>
          <span className="text-xs text-slate-500">{course.term}</span>
          {course.archived ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              已归档
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-slate-600">{course.title}</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">{course.memberCount} 人</span>
        <Link
          className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          href={`/courses/${course.id}`}
        >
          {course.archived ? "查看记录" : "进入群聊"}
        </Link>
      </div>
    </li>
  );
}
