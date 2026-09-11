"use server";

import { getCurrentMember } from "@/features/auth/session";

import { createProductionReportingService } from "./production-reporting-service";
import type { ReportActionState } from "./report-action-state";
import type { ReportReason, ReportTargetType } from "./reporting-service";

const MESSAGES: Record<string, string> = {
  created: "举报已提交。举报不会自动拉黑或处罚对方。",
  already_pending: "你已经举报过这项内容，我们保留了原举报。",
  invalid_target: "举报目标无效。",
  invalid_reason: "请选择有效的举报原因。",
  invalid_details: "补充说明最多 1000 个字符；选择“其他”时必须填写。",
  self_report: "不能举报自己发布的内容或自己的资料。",
  not_available: "该内容不存在或你无权查看。",
  onboarding_required: "请先完成个人资料。",
  temporarily_unavailable: "举报服务暂时不可用，请稍后重试。",
  unauthorized: "请先登录。",
};

function feedback(status: string, reportId?: string): ReportActionState {
  return {
    status,
    message: MESSAGES[status] ?? MESSAGES.temporarily_unavailable,
    ...(reportId ? { reportId } : {}),
  };
}

export async function submitBehaviorReportAction(
  _previousState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const member = await getCurrentMember();
  if (!member) return feedback("unauthorized");
  if (!member.onboardingComplete) return feedback("onboarding_required");

  const service = await createProductionReportingService();
  const result = await service.createReport({
    targetType: String(formData.get("targetType") ?? "") as ReportTargetType,
    targetId: String(formData.get("targetId") ?? ""),
    reason: String(formData.get("reason") ?? "") as ReportReason,
    details: formData.get("details") === null
      ? null
      : String(formData.get("details")),
  });
  return feedback(
    result.status,
    "reportId" in result ? result.reportId : undefined,
  );
}
