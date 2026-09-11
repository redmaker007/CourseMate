// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const authQueries = vi.hoisted(() => ({ getEnabledSchools: vi.fn() }));
const courseQueries = vi.hoisted(() => ({
  getDashboardCourses: vi.fn(),
  searchAvailableCourses: vi.fn(),
}));
const messageService = vi.hoisted(() => ({ getUnreadCounts: vi.fn() }));
const messageProduction = vi.hoisted(() => ({ createService: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/auth/queries", () => authQueries);
vi.mock("@/features/courses/queries", () => courseQueries);
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: messageProduction.createService,
}));
vi.mock("@/features/dashboard/components/dashboard-header", () => ({
  DashboardHeader: () => <div>Dashboard header</div>,
}));
vi.mock("@/features/dashboard/components/course-card", () => ({
  CourseCard: ({ course }: { course: { title: string } }) => <li>{course.title}</li>,
}));
vi.mock("@/features/courses/components/course-search", () => ({
  CourseSearch: ({ query, results }: { query: string; results: { title: string }[] }) => (
    <div>search:{query}:{results.map((course) => course.title).join(",")}</div>
  ),
}));

import DashboardPage from "./page";

const MEMBER = {
  userId: "member-1",
  schoolId: "uw-madison",
  email: "member@wisc.edu",
  onboardingComplete: true,
};

describe("DashboardPage course flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    authQueries.getEnabledSchools.mockResolvedValue([]);
    courseQueries.getDashboardCourses.mockResolvedValue({
      current: [{ id: "current", title: "Current course" }],
      archived: [{ id: "archive", title: "Archived course" }],
    });
    courseQueries.searchAvailableCourses.mockResolvedValue([
      { id: "search", title: "Search result" },
    ]);
    messageProduction.createService.mockResolvedValue(messageService);
    messageService.getUnreadCounts.mockResolvedValue({
      status: "loaded",
      counts: { visible: 2, hidden: 7 },
    });
  });

  afterEach(() => cleanup());

  it("separates current and archived courses and passes the search query", async () => {
    render(
      await DashboardPage({
        searchParams: Promise.resolve({ q: "TEST00" }),
      }),
    );

    expect(screen.getByText("Current course")).toBeTruthy();
    expect(screen.getByText("Archived course")).toBeTruthy();
    expect(screen.getByText("search:TEST00:Search result")).toBeTruthy();
    expect(screen.getByRole("link", { name: /2 条私聊未读/ })).toHaveProperty(
      "href",
      "http://localhost:3000/friends",
    );
    expect(courseQueries.searchAvailableCourses).toHaveBeenCalledWith(
      MEMBER,
      "TEST00",
    );
  });

  it("requires profile onboarding before loading course data", async () => {
    auth.getCurrentMember.mockResolvedValue({
      ...MEMBER,
      onboardingComplete: false,
    });
    await expect(
      DashboardPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding/profile");
    expect(courseQueries.getDashboardCourses).not.toHaveBeenCalled();
  });
});
