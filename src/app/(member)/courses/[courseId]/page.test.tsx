// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const queries = vi.hoisted(() => ({ getCourseRoom: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/courses/queries", () => queries);
vi.mock("@/features/courses/components/course-chat", () => ({
  CourseChat: ({ archived }: { archived: boolean }) => (
    <div>chat:{archived ? "archived" : "active"}</div>
  ),
}));

import CoursePage from "./page";

const COURSE_ID = "13000000-0000-4000-8000-000000000001";
const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

describe("CoursePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue(MEMBER);
  });

  afterEach(() => cleanup());

  it("keeps an archived room readable and passes stable member ids", async () => {
    queries.getCourseRoom.mockResolvedValue({
      course: {
        id: COURSE_ID,
        code: "TEST00",
        title: "测试00-测试课程",
        term: "2026-fall",
        memberCount: 2,
        archived: true,
        conversationId: "conversation-1",
      },
      messages: [],
      hasOlderMessages: false,
      members: [
        {
          userId: "member-1",
          displayName: "Me",
          avatarUrl: null,
          relationshipStatus: "self",
          restrictionStatus: null,
          sendStatus: null,
          conversationId: null,
        },
        {
          userId: "member-2",
          displayName: "Friend",
          avatarUrl: null,
          relationshipStatus: "none",
          restrictionStatus: "none",
          sendStatus: null,
          conversationId: null,
        },
      ],
    });

    render(
      await CoursePage({
        params: Promise.resolve({ courseId: COURSE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText("chat:archived")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "退出课程" })).toBeNull();
    expect(screen.getByRole("link", { name: "添加好友" }).getAttribute("href")).toBe(
      "/friends/add?memberId=member-2",
    );
    expect(document.body.textContent).not.toContain("@wisc.edu");
  });

  it("renders authoritative relationship states without duplicate request entry points", async () => {
    queries.getCourseRoom.mockResolvedValue({
      course: {
        id: COURSE_ID,
        code: "TEST00",
        title: "测试课程",
        term: "2026-fall",
        memberCount: 8,
        archived: false,
        conversationId: "course-conversation",
      },
      messages: [],
      hasOlderMessages: false,
      members: [
        { userId: "member-1", displayName: "Me", relationshipStatus: "self" },
        {
          userId: "member-2",
          displayName: "Friend",
          relationshipStatus: "friend",
          restrictionStatus: "blocked",
          sendStatus: "blocked",
          conversationId: "direct-2",
        },
        {
          userId: "member-3",
          displayName: "Broken Friend",
          relationshipStatus: "friend",
          restrictionStatus: "none",
          sendStatus: null,
          conversationId: null,
        },
        { userId: "member-4", displayName: "Outgoing", relationshipStatus: "outgoing_request" },
        { userId: "member-5", displayName: "Incoming", relationshipStatus: "incoming_request" },
        {
          userId: "member-6",
          displayName: "Restricted",
          relationshipStatus: "none",
          restrictionStatus: "blocked",
        },
        {
          userId: "member-7",
          displayName: "Available",
          relationshipStatus: "none",
          restrictionStatus: "none",
        },
        { userId: "member-8", displayName: "Unavailable", relationshipStatus: "unavailable" },
      ],
    });

    render(
      await CoursePage({
        params: Promise.resolve({ courseId: COURSE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("link", { name: "发消息" }).getAttribute("href")).toBe(
      "/messages/direct-2",
    );
    expect(screen.getByText("好友数据异常")).toBeTruthy();
    expect(screen.getByText("申请已发送")).toBeTruthy();
    expect(screen.getByRole("link", { name: "处理申请" }).getAttribute("href")).toBe(
      "/friends",
    );
    expect(screen.getByText("当前无法添加")).toBeTruthy();
    expect(screen.getByText("关系状态暂不可用")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "添加好友" })).toHaveLength(1);
  });

  it("does not disclose a course room to a non-member", async () => {
    queries.getCourseRoom.mockResolvedValue(null);
    await expect(
      CoursePage({
        params: Promise.resolve({ courseId: COURSE_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
