// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const adminQueries = vi.hoisted(() => ({ getPlatformRole: vi.fn() }));
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
vi.mock("@/features/admin/queries", () => adminQueries);
vi.mock("@/features/auth/queries", () => authQueries);
vi.mock("@/features/courses/queries", () => courseQueries);
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: messageProduction.createService,
}));
vi.mock("@/features/dashboard/components/dashboard-header", () => ({
  DashboardHeader: ({
    adminHref,
    schoolName,
  }: {
    adminHref?: string;
    schoolName: string;
  }) => (
    <div data-school={schoolName}>
      Dashboard header{adminHref ? ` → ${adminHref}` : ""}
    </div>
  ),
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
    adminQueries.getPlatformRole.mockResolvedValue(null);
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

  it("只有带平台身份的成员在页头看到管理入口", async () => {
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Dashboard header")).toBeTruthy();
    cleanup();

    adminQueries.getPlatformRole.mockResolvedValue("admin");
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Dashboard header → /admin")).toBeTruthy();
    expect(screen.getByRole("link", { name: /2 条私聊未读/ })).toHaveProperty(
      "href",
      "http://localhost:3000/friends",
    );
  });

  it("四路数据同时发出，而不是一路等完再发下一路", { timeout: 1000 }, async () => {
    // 每一路都要等到四路全部开始才会返回；若是串行发起，第一路永远等不到其余三路，
    // 测试会因超时失败。
    const started = new Set<string>();
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begin = (name: string) => {
      started.add(name);
      if (started.size === 4) release();
      return allStarted;
    };
    adminQueries.getPlatformRole.mockImplementation(async () => {
      await begin("role");
      return null;
    });
    authQueries.getEnabledSchools.mockImplementation(async () => {
      await begin("schools");
      return [];
    });
    courseQueries.getDashboardCourses.mockImplementation(async () => {
      await begin("courses");
      return { current: [], archived: [] };
    });
    messageProduction.createService.mockImplementation(async () => {
      await begin("unread");
      return messageService;
    });

    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect([...started].sort()).toEqual(["courses", "role", "schools", "unread"]);
  });

  it("学校名取不到时退回学校 ID，其余内容照常显示", async () => {
    authQueries.getEnabledSchools.mockRejectedValue(new Error("boom"));
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Dashboard header").getAttribute("data-school")).toBe(
      "uw-madison",
    );
    expect(screen.getByText("Current course")).toBeTruthy();
  });

  it("拿到学校列表时显示学校中文名", async () => {
    authQueries.getEnabledSchools.mockResolvedValue([
      { id: "uw-madison", nameZh: "威斯康星大学麦迪逊分校" },
    ]);
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Dashboard header").getAttribute("data-school")).toBe(
      "威斯康星大学麦迪逊分校",
    );
  });

  it("课程数据失败只提示不可用，不影响未读数与页头", async () => {
    courseQueries.getDashboardCourses.mockRejectedValue(new Error("boom"));
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("课程数据暂时不可用，请稍后刷新。")).toBeTruthy();
    expect(screen.queryByText("Current course")).toBeNull();
    expect(screen.getByRole("link", { name: /2 条私聊未读/ })).toBeTruthy();
  });

  it("未读数失败时退回默认入口，课程照常显示", async () => {
    messageProduction.createService.mockRejectedValue(new Error("boom"));
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: /查看好友/ })).toBeTruthy();
    expect(screen.getByText("Current course")).toBeTruthy();

    cleanup();
    messageProduction.createService.mockResolvedValue(messageService);
    messageService.getUnreadCounts.mockResolvedValue({ status: "unavailable" });
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: /查看好友/ })).toBeTruthy();
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
