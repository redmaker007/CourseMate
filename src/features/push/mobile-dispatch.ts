import { timingSafeEqual } from "node:crypto";
import { isUuid } from "@/features/courses/course-identifiers";
import type { MobilePushJob, PushOutcome } from "./apns";
import type { PushRpc } from "./mobile-api";

export async function dispatchMobilePush(rpc: PushRpc, environment: "sandbox" | "production", send: (job: MobilePushJob) => Promise<PushOutcome>) {
  const { data, error } = await rpc("claim_mobile_push_jobs", { batch_size: 5, target_environment: environment });
  if (error || !Array.isArray(data) || data.length>5 || data.some(row => !row || !isUuid(row.job_id) || !isUuid(row.lease)
    || !isUuid(row.recipient_id) || !isUuid(row.conversation_id) || typeof row.device_token!=="string"
    || !/^[0-9a-f]{32,512}$/.test(row.device_token) || row.device_token.length%2!==0
    || typeof row.sender_name!=="string" || !row.sender_name.trim() || [...row.sender_name].length>15)) throw new Error("Invalid push claim response");
  const result = { claimed: data.length, sent: 0, retry: 0, invalid_token: 0, failed: 0, stale: 0, unsettled: 0 };
  await Promise.all(data.map(async (job: MobilePushJob) => {
    try {
      let outcome: PushOutcome;
      try { outcome = await send(job); } catch { outcome = "retry"; }
      const ack = await rpc("finish_mobile_push_job", { target_job: job.job_id, target_lease: job.lease, outcome });
      if (ack.error || !["recorded","stale"].includes(String(ack.data))) { result.unsettled++; return; }
      if (ack.data === "stale") result.stale++; else result[outcome]++;
    } catch { result.unsettled++; }
  }));
  return result;
}

export function createPushDispatchHandler(getSecret: () => string | undefined, run: () => Promise<unknown>) {
  return async (request: Request) => {
    const reply = (body: unknown, status: number, extra?: Record<string,string>) => Response.json(body, { status,
      headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...extra } });
    if (request.method !== "POST") return reply({ status: "method_not_allowed" },405,{allow:"POST"});
    const secret = getSecret();
    if (!secret || secret.length<32) return reply({ status: "temporarily_unavailable" },503);
    const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (expected.length!==actual.length || !timingSafeEqual(expected,actual)) return reply({ status: "authentication_required" },401);
    if (new URL(request.url).searchParams.size) return reply({ status: "invalid_request" },400);
    // Next 的空 POST 也可能有空流；只拒绝实际字节，不把合法调度误报为 400。
    const reader = request.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.length) { await reader.cancel(); return reply({ status: "invalid_request" },400); }
        }
      } finally { reader.releaseLock(); }
    }
    try { return reply({ status: "processed", result: await run() },200); }
    catch { return reply({ status: "temporarily_unavailable" },503); }
  };
}
