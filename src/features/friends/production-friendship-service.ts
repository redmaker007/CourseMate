import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createFriendshipService } from "./friendship-service";
import {
  createSupabaseFriendBackend,
  type FriendshipRpcClient,
} from "./supabase-friend-backend";

export async function createProductionFriendshipService() {
  const supabase = await createClient();
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    arguments_: Record<string, unknown>,
  ) => ReturnType<FriendshipRpcClient["rpc"]>;
  return createFriendshipService(
    createSupabaseFriendBackend({ rpc: invokeRpc }),
  );
}
