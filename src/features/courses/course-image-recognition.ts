import "server-only";

import sharp from "sharp";

import type { CurrentMember } from "@/features/auth/session";

import type { CourseCatalogEntry } from "./course-service";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;
const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type QuotaResult = {
  status:
    | "allowed"
    | "personal_limit"
    | "global_limit"
    | "onboarding_required";
  retryAfterSeconds: number;
};

type RecognitionDependencies = {
  loadCurrentCourses(member: CurrentMember): Promise<{
    term: string;
    courses: CourseCatalogEntry[];
  } | null>;
  consumeQuota(): Promise<QuotaResult>;
  detectText(image: {
    bytes: Buffer;
    mimeType: (typeof MIME_BY_FORMAT)[keyof typeof MIME_BY_FORMAT];
  }): Promise<string>;
};

export type CourseRecognitionCandidate = {
  courseId: string;
  code: string;
  title: string;
  matchedBy: "code";
  context: "uncertain";
  confidence: "medium";
  defaultSelected: false;
};

export type CourseImageRecognitionResult =
  | { status: "recognized"; candidates: CourseRecognitionCandidate[] }
  | {
      status:
        | "invalid_image"
        | "no_current_term"
        | "no_text"
        | "no_candidates"
        | "onboarding_required"
        | "unavailable";
    }
  | {
      status: "personal_limit" | "global_limit";
      retryAfterSeconds: number;
    };

async function readImage(file: File) {
  if (
    file.size === 0 ||
    file.size > MAX_IMAGE_BYTES ||
    !Object.values(MIME_BY_FORMAT).includes(
      file.type as (typeof MIME_BY_FORMAT)[keyof typeof MIME_BY_FORMAT],
    )
  ) {
    return null;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    const expectedMime = metadata.format
      ? MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT]
      : undefined;
    if (
      !expectedMime ||
      expectedMime !== file.type ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      return null;
    }
    await image.stats();
    return { bytes, mimeType: expectedMime };
  } catch {
    return null;
  }
}

function matchesCode(text: string, code: string) {
  const parts = code.match(/[a-z]+|\d+/gi);
  if (!parts?.length) return false;
  return new RegExp(
    `(^|[^a-z0-9])${parts.join("[^a-z0-9]*")}(?=$|[^a-z0-9])`,
    "i",
  ).test(text);
}

export function createCourseImageRecognizer(
  dependencies: RecognitionDependencies,
) {
  return async function recognizeCourseImage(
    member: CurrentMember,
    file: File,
  ): Promise<CourseImageRecognitionResult> {
    const image = await readImage(file);
    if (!image) return { status: "invalid_image" };

    const catalog = await dependencies.loadCurrentCourses(member);
    if (!catalog) return { status: "no_current_term" };

    const quota = await dependencies.consumeQuota();
    if (quota.status !== "allowed") {
      return quota.status === "personal_limit" || quota.status === "global_limit"
        ? {
            status: quota.status,
            retryAfterSeconds: quota.retryAfterSeconds,
          }
        : { status: "onboarding_required" };
    }

    let text: string;
    try {
      text = (await dependencies.detectText(image)).trim();
    } catch {
      return { status: "unavailable" };
    }
    if (!text) return { status: "no_text" };

    const candidates = catalog.courses
      .filter(
        (course) =>
          course.schoolId === member.schoolId && course.term === catalog.term,
      )
      .filter((course) => matchesCode(text, course.code))
      .map((course): CourseRecognitionCandidate => ({
        courseId: course.id,
        code: course.code,
        title: course.title,
        matchedBy: "code",
        context: "uncertain",
        confidence: "medium",
        defaultSelected: false,
      }));
    return candidates.length
      ? { status: "recognized", candidates }
      : { status: "no_candidates" };
  };
}
