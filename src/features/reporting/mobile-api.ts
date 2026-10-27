import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberContext } from "@/features/auth/member-session";
import { isUuid } from "@/features/courses/course-identifiers";
import { isMobileMessageId } from "@/features/messages/mobile-message-data";
import type { Database } from "@/types/database";

import { createReportingService, type ReportReason, type ReportTargetType } from "./reporting-service";
import { createSupabaseReportingBackend, type ReportingRpcClient } from "./supabase-reporting-backend";

export function mobileReportMethods(path: string) {
  return path === "reports" ? ["POST"] : undefined;
}

export function mobileReportHttpStatus(status: string) {
  if (status === "created") return 201;
  if (status === "already_pending") return 200;
  if (["invalid_request", "invalid_target", "invalid_reason", "invalid_details"].includes(status)) return 400;
  if (["onboarding_required", "self_report"].includes(status)) return 403;
  if (status === "not_available") return 404;
  return 503;
}

export async function handleMobileReportRequest(request: Request, body: Record<string, unknown>, supabase: SupabaseClient<Database>, member: MemberContext) {
  if (!member.onboardingComplete) return { status: "onboarding_required" };
  if (new URL(request.url).searchParams.size || Object.keys(body).some(key => !["targetType", "targetId", "reason", "details"].includes(key))
    || ["targetType", "targetId", "reason"].some(key => typeof body[key] !== "string")
    || (body.details !== undefined && body.details !== null && typeof body.details !== "string")) return { status: "invalid_request" };
  const targetType = body.targetType as ReportTargetType;
  const targetId = body.targetId as string;
  if (targetType === "message" && !isMobileMessageId(targetId)) return { status: "invalid_target" };
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as ReportingRpcClient["rpc"];
  const service = createReportingService(createSupabaseReportingBackend({ async rpc(name, args) {
    const result = await invokeRpc(name, args);
    if (!result.error && (!Array.isArray(result.data) || result.data.length !== 1)) throw new Error("Invalid report response");
    return result;
  } }));
  const result = await service.createReport({ targetType, targetId: targetType === "message" ? targetId : targetId.toLowerCase(),
    reason: body.reason as ReportReason, details: typeof body.details === "string" ? body.details : null });
  if ("reportId" in result && !isUuid(result.reportId)) return { status: "temporarily_unavailable" };
  return result;
}
