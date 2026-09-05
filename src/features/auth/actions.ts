"use server";

import { createProductionEmailOtpService } from "./production-email-otp-service";
import type { RequestEmailCodeActionState } from "./request-email-code-state";

const MESSAGES: Record<Exclude<RequestEmailCodeActionState["status"], "idle">, string> = {
  already_signed_in: "你已经登录，无需再次获取验证码。",
  code_sent: "验证码已发送，请检查收件箱和垃圾邮件。",
  invalid_email: "请输入有效邮箱。",
  rate_limited: "操作过于频繁，请稍后再试。",
  send_failed: "验证码发送失败，请稍后重试。",
  temporarily_unavailable: "服务暂时不可用，请稍后重试。",
};

export async function requestEmailCodeAction(
  _previousState: RequestEmailCodeActionState,
  formData: FormData,
): Promise<RequestEmailCodeActionState> {
  const schoolId = String(formData.get("schoolId") ?? "");
  const email = String(formData.get("email") ?? "");
  const requestId = crypto.randomUUID();

  let result;
  try {
    const service = await createProductionEmailOtpService();
    result = await service.requestEmailCode(schoolId, email);
  } catch {
    result = { status: "temporarily_unavailable" } as const;
  }

  console.info(
    JSON.stringify({
      operation: "request_email_code",
      outcome: result.status,
      requestId,
      schoolId,
    }),
  );

  return { ...result, message: MESSAGES[result.status] };
}
