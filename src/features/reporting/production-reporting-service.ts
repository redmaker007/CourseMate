import "server-only";

import { createClient } from "@/lib/supabase/server";

import { createReportingService } from "./reporting-service";
import {
  createSupabaseReportingBackend,
  type ReportingRpcClient,
} from "./supabase-reporting-backend";

export async function createProductionReportingService() {
  const supabase = await createClient();
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    arguments_: Record<string, unknown>,
  ) => ReturnType<ReportingRpcClient["rpc"]>;
  return createReportingService(
    createSupabaseReportingBackend({ rpc: invokeRpc }),
  );
}
