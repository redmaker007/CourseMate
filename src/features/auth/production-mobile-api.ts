import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import type { Database } from "@/types/database";
import { scheduleFriendRequestPush, scheduleDirectMessagePush } from "@/features/push/schedule";

import { createEmailOtpContextCodec } from "./email-otp-context";
import { createMobileAuthApi } from "./mobile-api";

export const mobileAuthApi = createMobileAuthApi({
  createClient(accessToken) {
    // 每请求隔离；Cookie 与服务端共享内存不能成为另一个账号的会话来源。
    return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    });
  },
  getCodec: () => createEmailOtpContextCodec(serverEnv.emailOtpContextSecret),
  onFriendRequestSent: scheduleFriendRequestPush,
  onDirectMessageSent: scheduleDirectMessagePush,
});
