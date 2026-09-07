import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { createSupabaseMemberSessionReader } from "@/features/auth/supabase-email-otp-adapters";
import { env } from "@/lib/env";
import { hardenSessionCookieOptions } from "@/lib/supabase/session-cookie-options";
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
            cookieStore.set(
              name,
              value,
              hardenSessionCookieOptions(
                options,
                process.env.NODE_ENV === "production",
              ),
            );
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
 * 读取当前 CourseMate 成员会话。返回 null 表示未登录。
 *
 * 这里与 OTP 认证和 Proxy 复用同一个成员会话定义：服务端验证过的
 * Supabase 用户、Member Account 及一致的学校绑定缺一不可。
 */
export async function getMemberSession() {
  const supabase = await createClient();
  return createSupabaseMemberSessionReader(supabase).getMemberSession();
}
