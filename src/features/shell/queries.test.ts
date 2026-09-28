import { beforeEach, describe, expect, it, vi } from "vitest";

const courseQueries = vi.hoisted(() => ({ getDashboardCourses: vi.fn() }));
const adminQueries = vi.hoisted(() => ({ getPlatformRole: vi.fn() }));
const messageService = vi.hoisted(() => ({ getUnreadCounts: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/courses/queries", () => courseQueries);
vi.mock("@/features/admin/queries", () => adminQueries);
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: async () => messageService,
}));

import { loadShellData } from "./queries";

const member = {
  userId: "u1",
  schoolId: "uw-madison",
  email: "a@wisc.edu",
  onboardingComplete: true,
};

describe("loadShellData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    courseQueries.getDashboardCourses.mockResolvedValue({
      current: [{ id: "c1", code: "MATH 221", title: "Calculus", term: "2026-fall" }],
      archived: [{ id: "old", code: "MATH 101", title: "Old" }],
    });
    messageService.getUnreadCounts.mockResolvedValue({
      status: "loaded",
      counts: { visible: 4 },
    });
    adminQueries.getPlatformRole.mockResolvedValue(null);
  });

  it("只取当前学期课程，并带上未读数与管理入口开关", async () => {
    await expect(loadShellData(member)).resolves.toEqual({
      courses: [{ id: "c1", code: "MATH 221", title: "Calculus" }],
      directUnread: 4,
      showAdmin: false,
    });
  });

  it("有平台身份时显示管理入口", async () => {
    adminQueries.getPlatformRole.mockResolvedValue("owner");
    expect((await loadShellData(member)).showAdmin).toBe(true);
  });

  it("课程或未读读取失败时降级为空，不抛错", async () => {
    courseQueries.getDashboardCourses.mockRejectedValue(new Error("down"));
    messageService.getUnreadCounts.mockResolvedValue({ status: "temporarily_unavailable" });

    await expect(loadShellData(member)).resolves.toEqual({
      courses: [],
      directUnread: 0,
      showAdmin: false,
    });
  });
});
