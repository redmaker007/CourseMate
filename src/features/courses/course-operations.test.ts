import { describe, expect, it, vi } from "vitest";

import { createCourseOperations } from "./course-operations";

describe("CourseOperations", () => {
  it("只用当前会话身份加入本校当前学期课程", async () => {
    const joinOwnCourse = vi.fn().mockResolvedValue(undefined);
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: async () => ({
        id: "course-1",
        schoolId: "uw-madison",
        term: "2026-fall",
        currentTerm: "2026-fall",
      }),
      getJoinedCourse: vi.fn(),
      joinOwnCourse,
      leaveOwnCourse: vi.fn(),
      insertOwnMessage: vi.fn(),
    });

    await expect(operations.joinCourse("course-1")).resolves.toEqual({
      status: "joined",
    });
    expect(joinOwnCourse).toHaveBeenCalledWith("course-1");
  });

  it("只允许退出当前学期的已加入课程", async () => {
    const leaveOwnCourse = vi.fn().mockResolvedValue(undefined);
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: vi.fn(),
      getJoinedCourse: async () => ({
        courseId: "course-1",
        conversationId: "conversation-1",
        archived: false,
      }),
      joinOwnCourse: vi.fn(),
      leaveOwnCourse,
      insertOwnMessage: vi.fn(),
    });

    await expect(operations.leaveCourse("course-1")).resolves.toEqual({
      status: "left",
    });
    expect(leaveOwnCourse).toHaveBeenCalledWith("course-1");
  });

  it("向服务端重新确认的活跃课程会话发送规范化文字", async () => {
    const savedMessage = {
      id: 9,
      senderId: "member-1",
      senderName: "Alice",
      body: "hello",
      createdAt: "2026-09-10T00:00:00Z",
    };
    const insertOwnMessage = vi.fn().mockResolvedValue(savedMessage);
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: vi.fn(),
      getJoinedCourse: async () => ({
        courseId: "course-1",
        conversationId: "conversation-1",
        archived: false,
      }),
      joinOwnCourse: vi.fn(),
      leaveOwnCourse: vi.fn(),
      insertOwnMessage,
    });

    await expect(
      operations.sendCourseMessage("course-1", "  hello  "),
    ).resolves.toEqual({ status: "sent", message: savedMessage });
    expect(insertOwnMessage).toHaveBeenCalledWith("conversation-1", "hello");
  });

  it.each([
    ["another school", "umich", "2026-fall", "2026-fall"],
    ["an old term", "uw-madison", "2025-fall", "2026-fall"],
  ])("does not join %s", async (_label, schoolId, term, currentTerm) => {
    const joinOwnCourse = vi.fn();
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: async () => ({
        id: "course-1",
        schoolId,
        term,
        currentTerm,
      }),
      getJoinedCourse: vi.fn(),
      joinOwnCourse,
      leaveOwnCourse: vi.fn(),
      insertOwnMessage: vi.fn(),
    });

    await expect(operations.joinCourse("course-1")).resolves.toEqual({
      status: "not_available",
    });
    expect(joinOwnCourse).not.toHaveBeenCalled();
  });

  it("does not leave or send to an archived course", async () => {
    const leaveOwnCourse = vi.fn();
    const insertOwnMessage = vi.fn();
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: vi.fn(),
      getJoinedCourse: async () => ({
        courseId: "course-1",
        conversationId: "conversation-1",
        archived: true,
      }),
      joinOwnCourse: vi.fn(),
      leaveOwnCourse,
      insertOwnMessage,
    });

    await expect(operations.leaveCourse("course-1")).resolves.toEqual({
      status: "not_available",
    });
    await expect(
      operations.sendCourseMessage("course-1", "hello"),
    ).resolves.toEqual({ status: "not_available" });
    expect(leaveOwnCourse).not.toHaveBeenCalled();
    expect(insertOwnMessage).not.toHaveBeenCalled();
  });

  it("rejects messages longer than 4000 Unicode characters", async () => {
    const insertOwnMessage = vi.fn();
    const operations = createCourseOperations({
      getCurrentMember: async () => ({
        userId: "member-1",
        schoolId: "uw-madison",
        onboardingComplete: true,
      }),
      getCourseCandidate: vi.fn(),
      getJoinedCourse: vi.fn(),
      joinOwnCourse: vi.fn(),
      leaveOwnCourse: vi.fn(),
      insertOwnMessage,
    });

    await expect(
      operations.sendCourseMessage("course-1", "你".repeat(4001)),
    ).resolves.toEqual({ status: "invalid" });
    expect(insertOwnMessage).not.toHaveBeenCalled();
  });
});
