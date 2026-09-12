import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  joinCourse: vi.fn(),
  leaveCourse: vi.fn(),
  sendCourseMessage: vi.fn(),
}));
const boundary = vi.hoisted(() => ({ create: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("next/cache", () => cache);
vi.mock("./production-course-operations", () => ({
  createProductionCourseOperations: boundary.create,
}));

import {
  joinCourseAction,
  leaveCourseAction,
  sendCourseMessageAction,
} from "./actions";
import { initialCourseMessageActionState } from "./course-action-state";

const COURSE_ID = "13000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("course Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.create.mockResolvedValue(operations);
  });

  it("joins a validated course and redirects to its room", async () => {
    operations.joinCourse.mockResolvedValue({ status: "joined" });
    await expect(joinCourseAction(COURSE_ID)).rejects.toThrow(
      `NEXT_REDIRECT:/courses/${COURSE_ID}`,
    );
    expect(operations.joinCourse).toHaveBeenCalledWith(COURSE_ID);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects an invalid id before constructing the production boundary", async () => {
    await expect(joinCourseAction("not-a-uuid")).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?courseAction=invalid",
    );
    expect(boundary.create).not.toHaveBeenCalled();
  });

  it("leaves an active course and returns to Dashboard", async () => {
    operations.leaveCourse.mockResolvedValue({ status: "left" });
    await expect(leaveCourseAction(COURSE_ID)).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns the persisted message so the client can merge immediately", async () => {
    const savedMessage = {
      id: "7",
      senderId: "member-1",
      senderName: "Alice",
      body: "hello",
      createdAt: "2026-09-10T00:00:00Z",
    };
    operations.sendCourseMessage.mockResolvedValue({
      status: "sent",
      message: savedMessage,
    });
    const formData = new FormData();
    formData.set("courseId", COURSE_ID);
    formData.set("conversationId", CONVERSATION_ID);
    formData.set("clientMessageId", CLIENT_MESSAGE_ID);
    formData.set("body", "hello");

    await expect(
      sendCourseMessageAction(initialCourseMessageActionState, formData),
    ).resolves.toEqual({
      status: "sent",
      message: "消息已发送。",
      clientMessageId: CLIENT_MESSAGE_ID,
      attemptedBody: "hello",
      savedMessage,
    });
    expect(operations.sendCourseMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      CLIENT_MESSAGE_ID,
      "hello",
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/courses/${COURSE_ID}`);
  });

  it("does not expose production initialization errors", async () => {
    boundary.create.mockRejectedValue(new Error("private database detail"));
    const formData = new FormData();
    formData.set("courseId", COURSE_ID);
    formData.set("conversationId", CONVERSATION_ID);
    formData.set("clientMessageId", CLIENT_MESSAGE_ID);
    formData.set("body", "hello");

    await expect(
      sendCourseMessageAction(initialCourseMessageActionState, formData),
    ).resolves.toEqual({
      status: "unavailable",
      message: "消息暂时无法发送。",
      clientMessageId: CLIENT_MESSAGE_ID,
      attemptedBody: "hello",
    });
  });
});
