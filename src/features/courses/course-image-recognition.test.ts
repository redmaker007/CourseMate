import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCourseImageRecognizer } from "./course-image-recognition";

const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

const COURSES = [
  {
    id: "course-1",
    schoolId: "uw-madison",
    code: "CS 540",
    title: "Introduction to Artificial Intelligence",
    term: "2026-fall",
  },
  {
    id: "course-2",
    schoolId: "uw-madison",
    code: "STAT 301",
    title: "Introduction to Statistical Methods",
    term: "2026-fall",
  },
];

async function pngFile() {
  const bytes = await sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: "white",
    },
  })
    .png()
    .toBuffer();
  return new File([bytes], "courses.png", { type: "image/png" });
}

describe("course image recognizer", () => {
  it("把当前课程代码作为未勾选的可能课程返回", async () => {
    const recognize = createCourseImageRecognizer({
      loadCurrentCourses: vi.fn().mockResolvedValue({
        term: "2026-fall",
        courses: COURSES,
      }),
      consumeQuota: vi.fn().mockResolvedValue({
        status: "allowed",
        retryAfterSeconds: 0,
      }),
      detectText: vi.fn().mockResolvedValue(
        "Selected courses\ncs-540\nSTAT 301\nOTHER 999",
      ),
    });

    await expect(recognize(MEMBER, await pngFile())).resolves.toEqual({
      status: "recognized",
      candidates: [
        {
          courseId: "course-1",
          code: "CS 540",
          title: "Introduction to Artificial Intelligence",
          matchedBy: "code",
          context: "uncertain",
          confidence: "medium",
          defaultSelected: false,
        },
        {
          courseId: "course-2",
          code: "STAT 301",
          title: "Introduction to Statistical Methods",
          matchedBy: "code",
          context: "uncertain",
          confidence: "medium",
          defaultSelected: false,
        },
      ],
    });
  });

  it("即使适配器返回越界数据，也只匹配成员当前学校和学期", async () => {
    const recognize = createCourseImageRecognizer({
      loadCurrentCourses: vi.fn().mockResolvedValue({
        term: "2026-fall",
        courses: [
          COURSES[0],
          { ...COURSES[0], id: "other-school", schoolId: "umich" },
          { ...COURSES[0], id: "old-term", term: "2025-fall" },
        ],
      }),
      consumeQuota: vi.fn().mockResolvedValue({
        status: "allowed",
        retryAfterSeconds: 0,
      }),
      detectText: vi.fn().mockResolvedValue("CS 540"),
    });

    const result = await recognize(MEMBER, await pngFile());

    expect(result).toMatchObject({
      status: "recognized",
      candidates: [{ courseId: "course-1" }],
    });
  });

  it("图片无效时不查询课程、不消费额度，也不调用 OCR", async () => {
    const loadCurrentCourses = vi.fn();
    const consumeQuota = vi.fn();
    const detectText = vi.fn();
    const recognize = createCourseImageRecognizer({
      loadCurrentCourses,
      consumeQuota,
      detectText,
    });

    await expect(
      recognize(
        MEMBER,
        new File(["not an image"], "fake.png", { type: "image/png" }),
      ),
    ).resolves.toEqual({ status: "invalid_image" });
    expect(loadCurrentCourses).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(detectText).not.toHaveBeenCalled();
  });

  it("没有当前学期时不消费额度，额度用完时不调用 OCR", async () => {
    const consumeQuota = vi.fn();
    const detectText = vi.fn();
    const noTerm = createCourseImageRecognizer({
      loadCurrentCourses: vi.fn().mockResolvedValue(null),
      consumeQuota,
      detectText,
    });
    await expect(noTerm(MEMBER, await pngFile())).resolves.toEqual({
      status: "no_current_term",
    });
    expect(consumeQuota).not.toHaveBeenCalled();

    const limited = createCourseImageRecognizer({
      loadCurrentCourses: vi.fn().mockResolvedValue({
        term: "2026-fall",
        courses: COURSES,
      }),
      consumeQuota: vi.fn().mockResolvedValue({
        status: "personal_limit",
        retryAfterSeconds: 240,
      }),
      detectText,
    });
    await expect(limited(MEMBER, await pngFile())).resolves.toEqual({
      status: "personal_limit",
      retryAfterSeconds: 240,
    });
    expect(detectText).not.toHaveBeenCalled();
  });

  it("区分无文字、无课程和 OCR 服务异常", async () => {
    const base = {
      loadCurrentCourses: vi.fn().mockResolvedValue({
        term: "2026-fall",
        courses: COURSES,
      }),
      consumeQuota: vi.fn().mockResolvedValue({
        status: "allowed",
        retryAfterSeconds: 0,
      }),
    };

    await expect(
      createCourseImageRecognizer({
        ...base,
        detectText: vi.fn().mockResolvedValue("   "),
      })(MEMBER, await pngFile()),
    ).resolves.toEqual({ status: "no_text" });
    await expect(
      createCourseImageRecognizer({
        ...base,
        detectText: vi.fn().mockResolvedValue("OTHER 999"),
      })(MEMBER, await pngFile()),
    ).resolves.toEqual({ status: "no_candidates" });
    await expect(
      createCourseImageRecognizer({
        ...base,
        detectText: vi.fn().mockRejectedValue(new Error("provider failed")),
      })(MEMBER, await pngFile()),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
