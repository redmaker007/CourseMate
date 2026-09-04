import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { env } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * 在 proxy（Next 16 里 middleware 的新名字）中刷新 Supabase session。
 *
 * Server Component 不能写 cookie，所以刷新后的 token 必须在这里写回响应，
 * 否则用户会随机掉登录。这是 @supabase/ssr 要求的必要一环，不是可选优化。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // 先写回 request，让本次请求的下游（Server Component）读到新 token
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // 这些是 no-cache 相关头。不设的话 CDN/反向代理可能把带着 A 的 auth
          // cookie 的响应缓存下来发给 B。
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // 必须用 getUser()：它会去校验 JWT。只读 cookie 的 getSession() 在服务端不可信。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
