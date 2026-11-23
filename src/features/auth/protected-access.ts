import type { MemberSession } from "./member-session";

// 公开政策页同时在 proxy matcher 中排除；这里再列一次，避免以后改 matcher 时误把它们锁在登录后。
const PUBLIC_PATHS = ["/", "/login", "/privacy", "/terms", "/support"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) =>
      pathname === path ||
      (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}

export type ProtectedAccessDecision =
  | { status: "allow" }
  | { status: "redirect_to_login"; nextPath: string };

export function resolveProtectedAccess(
  pathname: string,
  session: MemberSession | null,
): ProtectedAccessDecision {
  if (isPublicPath(pathname) || session) return { status: "allow" };
  return { status: "redirect_to_login", nextPath: pathname };
}
