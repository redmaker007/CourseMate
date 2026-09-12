import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createDirectMessageService } from "./direct-message-service";
import {
  createSupabaseDirectMessageBackend,
  type DirectMessageRpcClient,
} from "./supabase-direct-message-backend";

export async function createProductionDirectMessageService() {
  const supabase = await createClient();
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    arguments_: Record<string, unknown>,
  ) => ReturnType<DirectMessageRpcClient["rpc"]>;
  return createDirectMessageService(
    createSupabaseDirectMessageBackend({ rpc: invokeRpc }),
  );
}
