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
      return schoolId === "uw-madison" ? "2026-fall" : null;
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

    expect(result.map((course) => course.id)).toEqual(["course-cs-540"]);
    expect(result[0].matchKind).toBe("exact_code");
  });

  it("支持代码前缀并保持确定顺序", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "CS 54");

    expect(result.map((course) => course.id)).toEqual([
      "course-cs-540",
      "course-cs-544",
    ]);
    expect(result.every((course) => course.matchKind === "code_prefix")).toBe(
      true,
    );
  });

  it("支持课程名称关键词", async () => {
    const service = createCourseService(createCatalog());
    const result = await service.searchCourses("uw-madison", "statistics");

    expect(result.map((course) => course.id)).toEqual(["course-stat-301"]);
    expect(result[0].matchKind).toBe("title_keyword");
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
