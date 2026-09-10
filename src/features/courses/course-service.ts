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
  | "title_keyword"
  | "title_similar";

export type CourseSearchResult = CourseCatalogEntry & {
  matchKind: CourseMatchKind;
};

export interface CourseDataAdapter {
  getCurrentTerm(schoolId: string): Promise<string | null>;
  listCatalogCourses(scope: {
    schoolId: string;
    term: string;
  }): Promise<CourseCatalogEntry[]>;
}

function normalizeCode(value: string) {
  return value.toLocaleUpperCase().replace(/[^A-Z0-9]/g, "");
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

function classifyMatch(course: CourseCatalogEntry, query: string) {
  const normalizedQueryCode = normalizeCode(query);
  const normalizedCourseCode = normalizeCode(course.code);
  const normalizedQueryTitle = normalizeTitle(query);
  const normalizedCourseTitle = normalizeTitle(course.title);

  if (normalizedQueryCode && normalizedCourseCode === normalizedQueryCode) {
    return { kind: "exact_code" as const, score: 1 };
  }
  if (
    normalizedQueryCode &&
    normalizedCourseCode.startsWith(normalizedQueryCode)
  ) {
    return { kind: "code_prefix" as const, score: 1 };
  }
  if (
    normalizedQueryTitle &&
    normalizedCourseTitle.includes(normalizedQueryTitle)
  ) {
    return { kind: "title_keyword" as const, score: 1 };
  }

  const similarity = titleSimilarity(
    normalizedCourseTitle,
    normalizedQueryTitle,
  );
  return similarity >= 0.65
    ? { kind: "title_similar" as const, score: similarity }
    : null;
}

const MATCH_PRIORITY: Record<CourseMatchKind, number> = {
  exact_code: 0,
  code_prefix: 1,
  title_keyword: 2,
  title_similar: 3,
};

export function createCourseService(data: CourseDataAdapter) {
  return {
    async searchCourses(schoolId: string, query: string) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) return [];

      const currentTerm = await data.getCurrentTerm(schoolId);
      if (!currentTerm) return [];

      const courses = await data.listCatalogCourses({
        schoolId,
        term: currentTerm,
      });

      return courses
        .map((course) => {
          const match = classifyMatch(course, normalizedQuery);
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
        .map(({ score, ...course }) => {
          void score;
          return course;
        });
    },
  };
}
