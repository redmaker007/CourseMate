import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import { createApnsSender } from "./apns";
import { dispatchMobilePush } from "./mobile-dispatch";
import type { PushRpc } from "./mobile-api";

export async function dispatchProductionMobilePush() {
  const config = serverEnv.apns;
  if (!config) throw new Error("APNs not configured");
  const client = createClient(env.supabaseUrl,config.serviceRoleKey,{ auth:{ persistSession:false,autoRefreshToken:false,detectSessionInUrl:false } });
  const rpc = client.rpc.bind(client) as unknown as PushRpc;
  return dispatchMobilePush(rpc,config.environment,createApnsSender(config));
}
