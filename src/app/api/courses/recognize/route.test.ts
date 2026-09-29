import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const recognition = vi.hoisted(() => ({ recognizeCourseImage: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/courses/production-course-image-recognition", () =>
  recognition,
);

import { POST } from "./route";

const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

function request() {
  const form = new FormData();
  form.set("image", new File(["image"], "courses.png", { type: "image/png" }));
  return new Request("http://localhost/api/courses/recognize", {
    method: "POST",
    body: form,
  });
}

describe("course image recognition route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("要求完整成员会话，并只返回识别模块的候选", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(recognition.recognizeCourseImage).not.toHaveBeenCalled();

    auth.getCurrentMember.mockResolvedValue(MEMBER);
    recognition.recognizeCourseImage.mockResolvedValue({
      status: "recognized",
      candidates: [{
        courseId: "course-1",
        code: "CS 540",
        title: "Artificial Intelligence",
        matchedBy: "code",
        context: "uncertain",
        confidence: "medium",
        defaultSelected: false,
      }],
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "recognized",
      candidates: [{ courseId: "course-1", defaultSelected: false }],
    });
    expect(recognition.recognizeCourseImage).toHaveBeenCalledWith(
      MEMBER,
      expect.any(File),
    );
  });

  it("在进入识别模块前拒绝未完成 onboarding 和缺少图片的请求", async () => {
    auth.getCurrentMember.mockResolvedValue({
      ...MEMBER,
      onboardingComplete: false,
    });
    expect((await POST(request())).status).toBe(403);

    auth.getCurrentMember.mockResolvedValue(MEMBER);
    const empty = new Request("http://localhost/api/courses/recognize", {
      method: "POST",
      body: new FormData(),
    });
    expect((await POST(empty)).status).toBe(400);
    expect(recognition.recognizeCourseImage).not.toHaveBeenCalled();
  });

  it("在解析 multipart 前拒绝超出总请求上限的正文", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    const oversized = new Request("http://localhost/api/courses/recognize", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new Uint8Array(3 * 1024 * 1024 + 64 * 1024 + 1),
    });

    expect((await POST(oversized)).status).toBe(400);
    expect(recognition.recognizeCourseImage).not.toHaveBeenCalled();
  });

  it("为额度、图片和临时服务错误返回安全状态码", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);

    recognition.recognizeCourseImage.mockResolvedValue({
      status: "personal_limit",
      retryAfterSeconds: 120,
    });
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("120");

    recognition.recognizeCourseImage.mockResolvedValue({
      status: "invalid_image",
    });
    expect((await POST(request())).status).toBe(400);

    recognition.recognizeCourseImage.mockRejectedValue(
      new Error("secret provider detail"),
    );
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable" });
  });
});
