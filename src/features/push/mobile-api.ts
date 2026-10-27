import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/features/courses/course-identifiers";
import type { Database } from "@/types/database";

// 待目标库迁移后由 CLI 重新生成 database.ts；不手改生成文件。
export type PushRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export function mobilePushMethods(path: string) { return path === "push/device" ? ["PUT", "DELETE"] : undefined; }
export async function removeCurrentMobileDevices(supabase: SupabaseClient<Database>, installationId?: string) {
  const { data, error } = await (supabase.rpc.bind(supabase) as unknown as PushRpc)("remove_mobile_push_device", { target_installation: installationId ?? null });
  if (error || data !== "removed") throw error ?? new Error("Invalid device removal response");
}
export async function handleMobilePushDevice(request: Request, body: Record<string, unknown>, supabase: SupabaseClient<Database>, environment?: "sandbox" | "production") {
  const register = request.method === "PUT";
  const keys = register ? ["installationId", "deviceToken"] : ["installationId"];
  if (new URL(request.url).searchParams.size || Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body,key))
    || !isUuid(body.installationId) || (register && (typeof body.deviceToken !== "string" || !/^[a-f0-9]{32,512}$/i.test(body.deviceToken) || body.deviceToken.length % 2 !== 0))) {
    return { status: "invalid_request" };
  }
  const installationId = (body.installationId as string).toLowerCase();
  if (!register) { await removeCurrentMobileDevices(supabase, installationId); return { status: "removed" }; }
  if (!environment) return { status: "temporarily_unavailable" };
  const { data, error } = await (supabase.rpc.bind(supabase) as unknown as PushRpc)("register_mobile_push_device", {
    target_installation: installationId, target_token: (body.deviceToken as string).toLowerCase(), target_environment: environment,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") return { status: "session_invalid" };
    throw error;
  }
  if (data !== "registered" && data !== "device_limit_reached") throw new Error("Invalid device registration response");
  return { status: data };
}
export function mobilePushHttpStatus(status: string) {
  if (["registered", "removed"].includes(status)) return 200;
  if (status === "invalid_request") return 400;
  if (status === "session_invalid") return 401;
  if (status === "device_limit_reached") return 409;
  return 503;
}
