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
      sendMessage: vi.fn(),
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
      sendMessage: vi.fn(),
    });

    await expect(operations.leaveCourse("course-1")).resolves.toEqual({
      status: "left",
    });
    expect(leaveOwnCourse).toHaveBeenCalledWith("course-1");
  });

  it("向服务端重新确认的活跃课程会话发送规范化文字", async () => {
    const savedMessage = {
      id: "9",
      clientMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      senderId: "member-1",
      senderName: "Alice",
      body: "hello",
      createdAt: "2026-09-10T00:00:00Z",
    };
    const sendMessage = vi.fn().mockResolvedValue({
      status: "sent",
      message: {
        id: "9",
        clientMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conversationId: "conversation-1",
        senderId: "member-1",
        senderDisplayName: "Alice",
        body: "hello",
        createdAt: "2026-09-10T00:00:00Z",
      },
    });
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
      sendMessage,
    });

    await expect(
      operations.sendCourseMessage(
        "conversation-1",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "  hello  ",
      ),
    ).resolves.toEqual({ status: "sent", message: savedMessage });
    expect(sendMessage).toHaveBeenCalledWith(
      "conversation-1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "hello",
    );
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
      sendMessage: vi.fn(),
    });

    await expect(operations.joinCourse("course-1")).resolves.toEqual({
      status: "not_available",
    });
    expect(joinOwnCourse).not.toHaveBeenCalled();
  });

  it("does not leave or send to an archived course", async () => {
    const leaveOwnCourse = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({ status: "not_available" });
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
      sendMessage,
    });

    await expect(operations.leaveCourse("course-1")).resolves.toEqual({
      status: "not_available",
    });
    await expect(
      operations.sendCourseMessage(
        "conversation-1",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "hello",
      ),
    ).resolves.toEqual({ status: "not_available" });
    expect(leaveOwnCourse).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("rejects messages longer than 4000 Unicode characters", async () => {
    const sendMessage = vi.fn();
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
      sendMessage,
    });

    await expect(
      operations.sendCourseMessage(
        "conversation-1",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "你".repeat(4001),
      ),
    ).resolves.toEqual({ status: "invalid" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
