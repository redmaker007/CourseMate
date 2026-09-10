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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-slate-950">搜索课程</h2>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" method="get">
        <label className="sr-only" htmlFor="course-query">
          课程代码或名称
        </label>
        <input
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          defaultValue={query}
          id="course-query"
          name="q"
          placeholder="例如 CS 540 或 Statistics"
          type="search"
        />
        <button
          className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-700"
          type="submit"
        >
          搜索
        </button>
      </form>

      {query ? (
        <ul className="mt-5 space-y-3">
          {results.length ? (
            results.map((course) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3"
                key={course.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-950">
                      {course.code}
                    </span>
                    <span className="text-xs text-slate-500">
                      {MATCH_LABELS[course.matchKind]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{course.title}</p>
                </div>
                {course.joined ? (
                  <Link
                    className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700"
                    href={`/courses/${course.id}`}
                  >
                    已加入
                  </Link>
                ) : (
                  <form action={joinCourseAction.bind(null, course.id)}>
                    <button
                      className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                      type="submit"
                    >
                      加入课程
                    </button>
                  </form>
                )}
              </li>
            ))
          ) : (
            <li className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-600">
              当前学校和学期没有找到匹配课程。
            </li>
          )}
        </ul>
      ) : null}
    </section>
  );
}
