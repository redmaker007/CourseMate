import type { PlaceholderCourse } from "../placeholder-data";

type CourseCardProps = {
  course: PlaceholderCourse;
};

export function CourseCard({ course }: CourseCardProps) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3.5 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-slate-950">{course.code}</span>
          <span className="text-xs text-slate-500">{course.term}</span>
          {course.unreadCount > 0 ? (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {course.unreadCount} 条未读
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-slate-600">{course.title}</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">{course.memberCount} 人</span>
        <button
          className="cursor-not-allowed rounded-full bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-400"
          disabled
          title="群聊功能尚未接入"
          type="button"
        >
          进入群聊
        </button>
      </div>
    </li>
  );
}
