import { Check, Search } from "lucide-react";
import Link from "next/link";

import { joinCourseAction } from "../actions";
import type { CourseSearchItem } from "../queries";

const MATCH_LABELS = {
  exact_code: "课号精确匹配",
  code_prefix: "课号前缀",
  title_keyword: "名称关键词",
  title_similar: "相似名称",
} as const;

export function CourseSearch({
  query,
  results,
}: {
  query: string;
  results: CourseSearchItem[];
}) {
  return (
    <section className="flex flex-col gap-3 p-3">
      <h2 className="sr-only">搜索课程</h2>
      <form className="flex gap-2" method="get">
        <label className="sr-only" htmlFor="course-query">
          课程代码或名称
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            size={14}
            strokeWidth={1.75}
          />
          <input
            className="h-9 w-full rounded-lg border border-line bg-card pl-8 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
            defaultValue={query}
            id="course-query"
            name="q"
            placeholder="搜索课程号或名称，例如 CS 540"
            type="search"
          />
        </div>
        <button
          className="h-9 shrink-0 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:bg-brand-hover"
          type="submit"
        >
          搜索
        </button>
      </form>

      {query ? (
        <ul className="flex flex-col gap-2">
          {results.length ? (
            results.map((course) => (
              <li
                className="rounded-xl border border-line bg-card p-3.5"
                key={course.id}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-bold text-ink">{course.code}</span>
                  <span className="text-xs text-muted">{MATCH_LABELS[course.matchKind]}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink">{course.title}</p>
                <div className="mt-2 flex justify-end">
                  {course.joined ? (
                    <Link
                      className="flex items-center gap-1 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success"
                      href={`/courses/${course.id}`}
                    >
                      <Check size={12} strokeWidth={2} />
                      已加入
                    </Link>
                  ) : (
                    <form action={joinCourseAction.bind(null, course.id)}>
                      <button
                        className="rounded-full bg-accent-soft px-3.5 py-1 text-xs font-medium text-accent transition hover:opacity-80"
                        type="submit"
                      >
                        加入课程
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))
          ) : (
            <li className="py-8 text-center text-sm text-muted">
              当前学校和学期没有找到匹配课程。
            </li>
          )}
        </ul>
      ) : (
        <p className="px-1 py-6 text-center text-xs text-muted">
          输入课号或课程名称，找到课程后点「加入课程」进入班级群聊。
        </p>
      )}
    </section>
  );
}
