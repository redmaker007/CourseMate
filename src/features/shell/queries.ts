import "server-only";

import { getPlatformRole } from "@/features/admin/queries";
import type { CurrentMember } from "@/features/auth/session";
import { getDashboardCourses } from "@/features/courses/queries";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";

export type ShellCourse = {
  id: string;
  code: string;
  title: string;
};

export type ShellData = {
  courses: ShellCourse[];
  directUnread: number;
  showAdmin: boolean;
};

// 导航栏上的内容都是辅助信息：任何一路读不到就降级为空，不能拦住页面本身。
async function loadCourses(member: CurrentMember): Promise<ShellCourse[]> {
  try {
    const { current } = await getDashboardCourses(member);
    return current.map(({ id, code, title }) => ({ id, code, title }));
  } catch {
    return [];
  }
}

async function loadDirectUnread(): Promise<number> {
  try {
    const service = await createProductionDirectMessageService();
    const result = await service.getUnreadCounts();
    return result.status === "loaded" ? result.counts.visible : 0;
  } catch {
    return 0;
  }
}

/** 三路互不依赖，同时取。 */
export async function loadShellData(member: CurrentMember): Promise<ShellData> {
  const [courses, directUnread, platformRole] = await Promise.all([
    loadCourses(member),
    loadDirectUnread(),
    getPlatformRole(),
  ]);
  return { courses, directUnread, showAdmin: platformRole !== null };
}
