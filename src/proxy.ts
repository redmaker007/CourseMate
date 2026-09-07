import { NextResponse, type NextRequest } from "next/server";

import { resolveProtectedAccess } from "@/features/auth/protected-access";
import { updateSession } from "@/lib/supabase/proxy";

const SESSION_RESPONSE_HEADERS = ["cache-control", "expires", "pragma"];

function redirectWithSessionState(url: URL, sessionResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of sessionResponse.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  for (const name of SESSION_RESPONSE_HEADERS) {
    const value = sessionResponse.headers.get(name);
    if (value) redirectResponse.headers.set(name, value);
  }

  return redirectResponse;
}

/**
 * Next 16 把 middleware 改名为 proxy，导出的函数名也从 middleware 变成 proxy。
 *
 * 这里只做两件事：刷新 session，以及把没有完整成员会话的用户挡在受保护路由外。
 * 数据访问仍由各 Server Action / Route Handler 和 Supabase RLS 重新授权，不能只信 Proxy。
 */
export async function proxy(request: NextRequest) {
  const { response, memberSession } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const access = resolveProtectedAccess(pathname, memberSession);

  if (access.status === "redirect_to_login") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", access.nextPath);
    return redirectWithSessionState(loginUrl, response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 跳过静态资源和图片优化请求，避免每个 asset 都打一次 Supabase auth。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
