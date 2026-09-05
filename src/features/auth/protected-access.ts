import type { MemberSession } from "./member-session";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth"];

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
