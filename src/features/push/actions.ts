"use server";

import { createClient } from "@/lib/supabase/server";

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type RpcClient = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

async function callRpc(name: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcClient;
  return rpc(name, args);
}

/** 本人保存当前设备的推送订阅。授权与数据校验在数据库函数里。 */
export async function savePushSubscriptionAction(
  input: PushSubscriptionInput,
): Promise<{ status: "saved" | "invalid" | "unavailable" }> {
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return { status: "invalid" };
  }
  try {
    const { data, error } = await callRpc("save_push_subscription", {
      target_endpoint: endpoint,
      target_p256dh: p256dh,
      target_auth: auth,
    });
    if (error) return { status: "unavailable" };
    return { status: data === "saved" ? "saved" : "invalid" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function removePushSubscriptionAction(
  endpoint: string,
): Promise<{ status: "removed" | "unavailable" }> {
  if (typeof endpoint !== "string") return { status: "unavailable" };
  try {
    const { error } = await callRpc("remove_push_subscription", { target_endpoint: endpoint });
    return { status: error ? "unavailable" : "removed" };
  } catch {
    return { status: "unavailable" };
  }
}
