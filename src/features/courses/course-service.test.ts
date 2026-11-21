import { describe, expect, it } from "vitest";

import {
  createCourseService,
  type CourseCatalogEntry,
  type CourseDataAdapter,
} from "./course-service";

const COURSES: CourseCatalogEntry[] = [
  {
    id: "course-cs-540",
    schoolId: "uw-madison",
    code: "CS 540",
    title: "Introduction to Artificial Intelligence",
    term: "2026-fall",
  },
  {
    id: "course-cs-544",
    schoolId: "uw-madison",
    code: "CS 544",
    title: "Introduction to Big Data Systems",
    term: "2026-fall",
  },
  {
    id: "course-stat-301",
    schoolId: "uw-madison",
    code: "STAT 301",
    title: "Introduction to Statistics",
    term: "2026-fall",
  },
  {
    id: "course-compsci-540",
    schoolId: "uw-madison",
    code: "COMP SCI 540",
    title: "Introduction to Artificial Intelligence (cross-listed)",
    term: "2026-fall",
  },
  {
    id: "course-eecs-280",
    schoolId: "umich",
    code: "EECS 280",
    title: "Programming and Intro Data Structures",
    term: "2026-fall",
  },
  {
    id: "course-old",
    schoolId: "uw-madison",
    code: "CS 400",
    title: "Programming III",
    term: "2025-fall",
  },
  {
    id: "course-other-school",
    schoolId: "umich",
    code: "CS 540",
    title: "Different School Course",
    term: "2026-fall",
  },
];

function createCatalog(): CourseDataAdapter {
  return {
    async getCurrentTerm(schoolId) {
      return schoolId === "uw-madison" || schoolId === "umich" ? "2026-fall" : null;
    },
    async listCatalogCourses({ schoolId, term }) {
      return COURSES.filter(
        (course) => course.schoolId === schoolId && course.term === term,
      );
    },
  };
}

describe("CourseService.searchCourses", () => {
  it("按代码精确匹配排在最前", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "cs540");

    // 'cs' 也是 COMP SCI 的缩写，两门课号都精确等于查询，原文课号排在前面
    expect(result.map((course) => course.id)).toEqual(["course-cs-540", "course-compsci-540"]);
    expect(result[0].matchKind).toBe("exact_code");
  });

  it("支持代码前缀并保持确定顺序", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "CS 54");

    expect(result.map((course) => course.id)).toEqual([
      "course-cs-540",
      "course-cs-544",
      "course-compsci-540",
    ]);
    expect(result.map((course) => course.matchKind)).toEqual([
      "code_prefix",
      "code_prefix",
      "subject_alias",
    ]);
  });

  it("支持课程名称关键词", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "big data");

    expect(result.map((course) => course.id)).toEqual(["course-cs-544"]);
    expect(result[0].matchKind).toBe("title_keyword");
  });

  it("常用缩写换成本校学科代码：cs 540 找到 COMP SCI 540", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "cs 540");

    expect(result.map((course) => course.id)).toEqual([
      "course-cs-540",
      "course-compsci-540",
    ]);
    expect(result.map((course) => course.matchKind)).toEqual(["exact_code", "exact_code"]);
  });

  it("学科全称和缩写都能列出该学科的课，排在原文课号前缀之后", async () => {
    const service = createCourseService(createCatalog());
    const byName = await service.searchCourses("uw-madison", "Computer Science");
    expect(byName.map((course) => course.id)).toEqual(["course-compsci-540"]);
    expect(byName[0].matchKind).toBe("subject_alias");

    const byStats = await service.searchCourses("uw-madison", "stats");
    expect(byStats.map((course) => course.id)).toEqual(["course-stat-301"]);
    expect(byStats[0].matchKind).toBe("subject_alias");
  });

  it("缩写按学校映射：密歇根的 cs 是 EECS", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("umich", "cs280");

    expect(result.map((course) => course.id)).toEqual(["course-eecs-280"]);
  });

  it("数据源支持候选查询时只用候选；直接匹配不到才读整份课表做近似匹配", async () => {
    const catalog = createCatalog();
    const calls: string[] = [];
    const service = createCourseService({
      ...catalog,
      async listCatalogCourses(scope) {
        calls.push("list");
        return catalog.listCatalogCourses(scope);
      },
      async findCandidateCourses({ schoolId, term, codePrefixes, titleTerm }) {
        calls.push(`find:${codePrefixes.join("|")}:${titleTerm}`);
        return COURSES.filter(
          (course) =>
            course.schoolId === schoolId &&
            course.term === term &&
            (codePrefixes.some((prefix) =>
              course.code.toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(prefix),
            ) ||
              course.title.toLowerCase().includes(titleTerm)),
        );
      },
    });

    expect((await service.searchCourses("uw-madison", "cs 54")).length).toBe(3);
    expect(calls).toEqual(["find:CS54|COMPSCI54:cs 54"]);

    calls.length = 0;
    const fuzzy = await service.searchCourses("uw-madison", "introdution to statstics");
    expect(fuzzy.map((course) => course.id)).toEqual(["course-stat-301"]);
    expect(calls).toEqual(["find:INTRODUTIONTOSTATSTICS:introdution to statstics", "list"]);
  });

  it("结果最多 50 条", async () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: `bulk-${index}`,
      schoolId: "uw-madison",
      code: `BULK ${100 + index}`,
      title: "Bulk",
      term: "2026-fall",
    }));
    const service = createCourseService({
      getCurrentTerm: async () => "2026-fall",
      listCatalogCourses: async () => many,
    });

    expect((await service.searchCourses("uw-madison", "bulk")).length).toBe(50);
  });

  it("支持近似课程名称且不会混入跨校或旧学期结果", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses(
      "uw-madison",
      "introdution to statstics",
    );

    expect(result.map((course) => course.id)).toEqual(["course-stat-301"]);
    expect(result[0].matchKind).toBe("title_similar");
  });
});
