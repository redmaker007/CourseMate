import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createDeletionContextCodec, isDeletionReceipt, receiptHash } from "./account-deletion-context";

export type DeletionDependencies = {
  createClient(accessToken?: string): SupabaseClient<Database>;
  getDeletionSecret?(): string;
  createDeletionAdmin?(): { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
};
export function mobileDeletionMethods(path: string) {
  return ["account/deletion", "account/deletion/challenge", "account/deletion/status"].includes(path) ? ["POST"] : undefined;
}
export function deletionHttpStatus(status: string) {
  if (["completed", "not_completed", "code_sent"].includes(status)) return 200;
  if (["invalid_request", "invalid_challenge", "invalid_or_expired_code"].includes(status)) return 400;
  if (status === "authentication_required" || status === "access_token_invalid") return 401;
  if (status === "identity_mismatch") return 403;
  if (["owner_transfer_required", "storage_cleanup_required"].includes(status)) return 409;
  if (status === "not_available") return 404;
  if (status === "rate_limited") return 429;
  return 503;
}
function authFailure(error: { status?: number; code?: string; name?: string }) {
  if (error.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code ?? "")) return { status: "rate_limited" };
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status !== undefined && error.status >= 500)) return { status: "temporarily_unavailable" };
  return { status: "invalid_or_expired_code" };
}

export async function handleMobileDeletionRequest(request: Request, path: string, body: Record<string, unknown>, accessToken: string | undefined, dependencies: DeletionDependencies) {
  const exact = (keys: string[]) => Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body,key));
  if (new URL(request.url).searchParams.size) return { status: "invalid_request" };
  const statusPath = path === "account/deletion/status", challengePath = path === "account/deletion/challenge";
  if (challengePath ? !exact([]) : statusPath ? !exact(["receiptToken"]) || !isDeletionReceipt(body.receiptToken)
    : !exact(["challengeToken","receiptToken","code","confirmation"]) || !isDeletionReceipt(body.receiptToken)
      || typeof body.challengeToken !== "string" || typeof body.code !== "string" || !/^\d{6}$/.test(body.code) || body.confirmation !== "DELETE") return { status: "invalid_request" };
  if (!dependencies.createDeletionAdmin || !dependencies.getDeletionSecret) return { status: "temporarily_unavailable" };
  const admin = dependencies.createDeletionAdmin();
  const call = async (name: string, args: Record<string, unknown>, allowed: string[]) => {
    const {data,error} = await admin.rpc(name,args);
    if (error || typeof data !== "string" || !allowed.includes(data)) throw error ?? new Error("Invalid deletion response");
    return data;
  };
  if (!challengePath) {
    const status = await call("get_account_deletion_receipt",{receipt_digest:receiptHash(body.receiptToken as string)},["completed","not_completed"]);
    if (statusPath || status === "completed") return { status };
  }
  if (!accessToken) return { status: "authentication_required" };
  // 注销不要求先补资料或恢复开放学校，但必须向 Auth 确认当前账号，不能只信任旧 JWT。
  const {data,error} = await dependencies.createClient(accessToken).auth.getUser(accessToken);
  if (error) return { status: error.status === 401 || error.status === 403 || ["bad_jwt","session_not_found","user_not_found"].includes(error.code ?? "") ? "access_token_invalid" : "temporarily_unavailable" };
  const user = data.user;
  if (!user?.id || !user.email) return { status: "access_token_invalid" };
  const codec = createDeletionContextCodec(dependencies.getDeletionSecret());
  if (challengePath) {
    const sent = await dependencies.createClient().auth.signInWithOtp({email:user.email,options:{shouldCreateUser:false}});
    return sent.error ? authFailure(sent.error) : { status: "code_sent", ...codec.issue(user.id,user.email) };
  }
  const context = codec.read(body.challengeToken as string);
  if (!context || context.receiptHash !== receiptHash(body.receiptToken as string)) return { status: "invalid_challenge" };
  if (context.userId !== user.id || context.email.toLowerCase() !== user.email.toLowerCase()) return { status: "identity_mismatch" };
  const verifier = dependencies.createClient();
  const verified = await verifier.auth.verifyOtp({email:user.email,token:body.code as string,type:"email"});
  if (verified.error) return authFailure(verified.error);
  const session = verified.data.session;
  let completed = false;
  try {
    if (!session || !verified.data.user?.email) return { status: "temporarily_unavailable" };
    if (verified.data.user.id !== user.id || verified.data.user.email.toLowerCase() !== user.email.toLowerCase()) return { status: "identity_mismatch" };
    const status = await call("permanently_delete_member",{target_user:user.id,receipt_digest:context.receiptHash},["completed","owner_transfer_required","storage_cleanup_required","not_available"]);
    completed = status === "completed";
    return { status };
  } finally {
    // 验码会创建临时会话；失败时撤销它，成功时已随 Auth 账号原子删除。
    if (!completed && session) { try { await verifier.auth.admin.signOut(session.access_token,"local"); } catch { /* 不覆盖原结果，也不暴露临时凭据。 */ } }
  }
}
