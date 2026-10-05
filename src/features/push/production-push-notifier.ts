import "server-only";

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

import { createPushNotifier, type PushNotifier, type PushTarget } from "./push-notifier";

type TargetRow = { endpoint: string; p256dh: string; auth_secret: string };
type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

/**
 * 推送发送器的生产接线。service_role 只在这里使用，且只调用三个受限函数：
 * 两个 claim 函数自己从数据库推导收件人并复查关系，调用方无法指定"发给谁"。
 * 配置不全（见 server-env.ts 的 push）时返回 null，调用方什么都不做。
 */
export function createProductionPushNotifier(): PushNotifier | null {
  const config = serverEnv.push;
  if (!config) return null;

  const supabase = createClient(
    env.supabaseUrl,
    config.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => RpcResult<unknown>;

  async function claim(name: string, args: Record<string, unknown>): Promise<PushTarget[]> {
    const { data, error } = await rpc(name, args);
    if (error) throw new Error(error.message);
    return ((data ?? []) as TargetRow[]).map((row) => ({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      authSecret: row.auth_secret,
    }));
  }

  return createPushNotifier({
    claimDirectMessage: (messageId) =>
      claim("claim_push_targets_for_direct_message", { target_message_id: messageId }),
    claimFriendRequest: (requestId) =>
      claim("claim_push_targets_for_friend_request", { target_request_id: requestId }),
    async send(target, payload) {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.authSecret } },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
          },
          TTL: 60 * 60,
          urgency: "high",
          timeout: 5_000,
        },
      );
    },
    async drop(endpoint) {
      await rpc("drop_push_subscription", { target_endpoint: endpoint });
    },
  });
}
