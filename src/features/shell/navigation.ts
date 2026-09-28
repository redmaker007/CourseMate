/** 导航栏与手机底栏共用的纯函数，单独放一个文件便于测试。 */

/**
 * 课程方块上显示的短课号：取最后一段课号数字，前面配学科缩写的前几个字母。
 * 'COMPSCI 300' → 'COMP 300'；'ACCT I S 100' → 'ACCT 100'。
 */
export function shortCourseCode(code: string): string {
  const parts = code.trim().split(/\s+/);
  if (parts.length < 2) return code.slice(0, 6);
  const number = parts[parts.length - 1];
  return `${parts[0].slice(0, 4).toUpperCase()} ${number}`;
}

/** 第 index 门已加入课程的颜色，8 色循环。 */
export function courseColor(index: number): string {
  return `var(--course-${index % 8})`;
}

export type NavSection = "dashboard" | "messages" | "profile" | "course" | "other";

/** 当前路径属于导航里的哪一项。私聊会话页和好友页都算「消息」。 */
export function navSectionFor(pathname: string): NavSection {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/courses/")) return "course";
  if (pathname.startsWith("/friends") || pathname.startsWith("/messages/")) {
    return "messages";
  }
  if (pathname.startsWith("/profile")) return "profile";
  return "other";
}

export function formatBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}
