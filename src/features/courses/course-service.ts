import { expandSubjectAliases, normalizeCode } from "./course-aliases";

export type CourseCatalogEntry = {
  id: string;
  schoolId: string;
  code: string;
  title: string;
  term: string;
};

export type CourseMatchKind =
  | "exact_code"
  | "code_prefix"
  | "subject_alias"
  | "title_keyword"
  | "title_similar";

export type CourseSearchResult = CourseCatalogEntry & {
  matchKind: CourseMatchKind;
};

/** 一次搜索最多返回的课程数。大学课表上万门，「A」这种前缀不能整份列出来。 */
export const SEARCH_RESULT_LIMIT = 50;

export interface CourseDataAdapter {
  getCurrentTerm(schoolId: string): Promise<string | null>;
  /** 当前学期的整份课表。只在直接匹配不到、需要做近似名称匹配时才读。 */
  listCatalogCourses(scope: {
    schoolId: string;
    term: string;
  }): Promise<CourseCatalogEntry[]>;
  /**
   * 可选：在数据库里先按课号前缀或课名关键词缩小范围，避免每次搜索都读整份课表。
   * 返回的是候选，最终是否匹配、怎么排序仍由本服务判断。
   */
  findCandidateCourses?(scope: {
    schoolId: string;
    term: string;
    codePrefixes: string[];
    titleTerm: string;
  }): Promise<CourseCatalogEntry[]>;
}

function normalizeTitle(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  let previous = rightCharacters.map((_, index) => index + 1);
  previous.unshift(0);

  for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (
      let rightIndex = 0;
      rightIndex < rightCharacters.length;
      rightIndex += 1
    ) {
      current.push(
        Math.min(
          current[rightIndex] + 1,
          previous[rightIndex + 1] + 1,
          previous[rightIndex] +
            (leftCharacters[leftIndex] === rightCharacters[rightIndex] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }

  return previous[rightCharacters.length];
}

function titleSimilarity(left: string, right: string) {
  const longest = Math.max(Array.from(left).length, Array.from(right).length);
  return longest === 0 ? 1 : 1 - editDistance(left, right) / longest;
}

type SearchPlan = {
  queryCode: string;
  aliasCodes: string[];
  queryTitle: string;
};

function planSearch(schoolId: string, query: string): SearchPlan {
  return {
    queryCode: normalizeCode(query),
    aliasCodes: expandSubjectAliases(schoolId, query),
    queryTitle: normalizeTitle(query),
  };
}

function classifyMatch(
  course: CourseCatalogEntry,
  plan: SearchPlan,
  { allowSimilar }: { allowSimilar: boolean },
) {
  const courseCode = normalizeCode(course.code);
  const courseTitle = normalizeTitle(course.title);

  if (plan.queryCode && courseCode === plan.queryCode) {
    return { kind: "exact_code" as const, score: 1 };
  }
  // 缩写换算出的课号也算精确，但排在和原文一模一样的课号后面。
  if (plan.aliasCodes.includes(courseCode)) {
    return { kind: "exact_code" as const, score: 0.99 };
  }
  if (plan.queryCode && courseCode.startsWith(plan.queryCode)) {
    return { kind: "code_prefix" as const, score: 1 };
  }
  if (plan.aliasCodes.some((prefix) => courseCode.startsWith(prefix))) {
    return { kind: "subject_alias" as const, score: 1 };
  }
  if (plan.queryTitle && courseTitle.includes(plan.queryTitle)) {
    return { kind: "title_keyword" as const, score: 1 };
  }
  if (!allowSimilar) return null;

  const similarity = titleSimilarity(courseTitle, plan.queryTitle);
  return similarity >= 0.65
    ? { kind: "title_similar" as const, score: similarity }
    : null;
}

const MATCH_PRIORITY: Record<CourseMatchKind, number> = {
  exact_code: 0,
  code_prefix: 1,
  subject_alias: 2,
  title_keyword: 3,
  title_similar: 4,
};

function rank(
  courses: CourseCatalogEntry[],
  plan: SearchPlan,
  options: { allowSimilar: boolean },
): CourseSearchResult[] {
  return courses
    .map((course) => {
      const match = classifyMatch(course, plan, options);
      return match ? { ...course, matchKind: match.kind, score: match.score } : null;
    })
    .filter(
      (course): course is CourseSearchResult & { score: number } =>
        course !== null,
    )
    .sort(
      (left, right) =>
        MATCH_PRIORITY[left.matchKind] - MATCH_PRIORITY[right.matchKind] ||
        right.score - left.score ||
        left.code.localeCompare(right.code) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, SEARCH_RESULT_LIMIT)
    .map(({ score, ...course }) => {
      void score;
      return course;
    });
}

export function createCourseService(data: CourseDataAdapter) {
  return {
    async searchCourses(schoolId: string, query: string) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) return [];

      const currentTerm = await data.getCurrentTerm(schoolId);
      if (!currentTerm) return [];

      const plan = planSearch(schoolId, normalizedQuery);

      if (data.findCandidateCourses) {
        const candidates = await data.findCandidateCourses({
          schoolId,
          term: currentTerm,
          codePrefixes: [plan.queryCode, ...plan.aliasCodes].filter(Boolean),
          titleTerm: plan.queryTitle,
        });
        const direct = rank(candidates, plan, { allowSimilar: false });
        if (direct.length > 0) return direct;
      }

      // 直接匹配不到（多半是拼错了课名）时才读整份课表做近似匹配。
      const courses = await data.listCatalogCourses({
        schoolId,
        term: currentTerm,
      });
      return rank(courses, plan, { allowSimilar: true });
    },
  };
}
