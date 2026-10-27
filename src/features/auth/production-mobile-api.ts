import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import { createIsolatedClient } from "@/lib/supabase/isolated";
import { scheduleFriendRequestPush, scheduleDirectMessagePush } from "@/features/push/schedule";

import { createEmailOtpContextCodec } from "./email-otp-context";
import { createMobileAuthApi } from "./mobile-api";

export const mobileAuthApi = createMobileAuthApi({
  // 每请求隔离；Cookie 与服务端共享内存不能成为另一个账号的会话来源。
  createClient: createIsolatedClient,
  getCodec: () => createEmailOtpContextCodec(serverEnv.emailOtpContextSecret),
  getDeletionSecret: () => serverEnv.emailOtpContextSecret,
  createDeletionAdmin: () => createClient(env.supabaseUrl, serverEnv.accountDeletionServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }),
  onFriendRequestSent: scheduleFriendRequestPush,
  onDirectMessageSent: scheduleDirectMessagePush,
  getPushEnvironment: () => serverEnv.apns?.environment,
});
