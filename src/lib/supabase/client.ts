import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * 浏览器端 Supabase 客户端。
 *
 * 只在 Client Component（"use client"）里用。它带的是 anon key，所有查询都受
 * RLS 约束——不要指望在这一层做权限控制，权限永远由数据库策略兜底。
 */
export function createClient() {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}
