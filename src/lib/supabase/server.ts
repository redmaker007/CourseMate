import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { env } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * 服务端 Supabase 客户端，用于 Server Component / Server Action / Route Handler。
 *
 * 每个请求都要新建一个，绝不能跨请求复用——复用会串号。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 在 Server Component 里不允许写 cookie。刷新 token 的写入由 src/proxy.ts
          // 负责，所以这里静默忽略是安全的。
        }
      },
    },
  });
}

/**
 * 拿当前登录用户。返回 null 表示未登录。
 *
 * 用 getUser() 而不是 getSession()：前者会向 Supabase 校验 JWT，后者只读 cookie，
 * 服务端信任未校验的 cookie 会被伪造。
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
