import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/** 未登录也能访问的路径前缀 */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}

/**
 * Next 16 把 middleware 改名为 proxy，导出的函数名也从 middleware 变成 proxy。
 *
 * 这里只做两件事：刷新 session，以及把未登录用户挡在受保护路由外。
 * 这是「乐观检查」——真正的授权由 Supabase RLS 策略负责，不要把权限判断挪到这里。
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
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
