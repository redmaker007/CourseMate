import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const queries = vi.hoisted(() => ({
  getCourseMessagesAfter: vi.fn(),
  getCourseMessagesBefore: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/courses/queries", () => queries);

import { GET } from "./route";

const COURSE_ID = "13000000-0000-4000-8000-000000000001";
const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

function request(after = "0", courseId = COURSE_ID) {
  return GET(new Request(`http://localhost/api/courses/${courseId}/messages?after=${after}`), {
    params: Promise.resolve({ courseId }),
  });
}

describe("course message backfill route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a complete member session", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    expect((await request()).status).toBe(401);

    auth.getCurrentMember.mockResolvedValue({
      ...MEMBER,
      onboardingComplete: false,
    });
    expect((await request()).status).toBe(403);
  });

  it("rejects unsafe cursors and malformed course ids", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    expect((await request("-1")).status).toBe(400);
    expect((await request("0", "not-a-uuid")).status).toBe(400);
    expect(queries.getCourseMessagesAfter).not.toHaveBeenCalled();
  });

  it("returns only messages authorized by the joined-course query", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    queries.getCourseMessagesAfter.mockResolvedValue({
      messages: [{ id: 12, body: "new" }],
      hasMore: false,
    });

    const response = await request("11");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messages: [{ id: 12, body: "new" }],
      hasMore: false,
    });
    expect(queries.getCourseMessagesAfter).toHaveBeenCalledWith(
      MEMBER,
      COURSE_ID,
      11,
    );
  });

  it("does not disclose whether an inaccessible course exists", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    queries.getCourseMessagesAfter.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("loads older history through an exclusive before cursor", async () => {
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    queries.getCourseMessagesBefore.mockResolvedValue({
      messages: [{ id: 4, body: "older" }],
      hasMore: true,
    });

    const response = await GET(
      new Request(`http://localhost/api/courses/${COURSE_ID}/messages?before=5`),
      { params: Promise.resolve({ courseId: COURSE_ID }) },
    );
    expect(response.status).toBe(200);
    expect(queries.getCourseMessagesBefore).toHaveBeenCalledWith(
      MEMBER,
      COURSE_ID,
      5,
    );
  });
});
