import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * 不读写 Cookie、只活在本次调用里的 Supabase 客户端。
 *
 * 用于移动接口（身份只来自 Bearer），以及设置密码时临时验一次验证码：
 * 验出的会话只在内存里，用完即退出，不会顶掉浏览器里原来的登录。
 */
export function createIsolatedClient(accessToken?: string) {
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
  });
}
