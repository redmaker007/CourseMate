"use server";

import { env } from "@/lib/env";

import { createEmailOtpContextCodec } from "./email-otp-context";
import { createProductionEmailOtpService } from "./production-email-otp-service";
import type { RequestEmailCodeActionState } from "./request-email-code-state";
import type { VerifyEmailCodeActionState } from "./verify-email-code-state";

const REQUEST_MESSAGES: Record<
  Exclude<RequestEmailCodeActionState["status"], "idle">,
  string
> = {
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
  let verificationContext = "";
  try {
    const contextCodec = createEmailOtpContextCodec(
      env.emailOtpContextSecret,
    );
    const service = await createProductionEmailOtpService();
    result = await service.requestEmailCode(schoolId, email);
    if (result.status === "code_sent") {
      verificationContext = contextCodec.issue({
        schoolId: result.schoolId,
        email: result.email,
      });
    }
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

  if (result.status === "code_sent") {
    return {
      ...result,
      message: REQUEST_MESSAGES.code_sent,
      verificationContext,
    };
  }

  return { ...result, message: REQUEST_MESSAGES[result.status] };
}

const VERIFY_MESSAGES: Record<
  Exclude<VerifyEmailCodeActionState["status"], "idle">,
  string
> = {
  signed_in: "邮箱验证成功，已登录。",
  already_signed_in: "你已经登录，无需再次验证。",
  invalid_email: "学校或邮箱信息无效，请返回并重新获取验证码。",
  invalid_or_expired_code: "验证码错误或已过期，请检查后重试。",
  rate_limited: "操作过于频繁，请稍后再试。",
  temporarily_unavailable: "服务暂时不可用，请稍后重试。",
};

export async function verifyEmailCodeAction(
  _previousState: VerifyEmailCodeActionState,
  formData: FormData,
): Promise<VerifyEmailCodeActionState> {
  const verificationContext = String(
    formData.get("verificationContext") ?? "",
  );
  const code = String(formData.get("code") ?? "");
  const requestId = crypto.randomUUID();

  let result;
  let schoolId = "unresolved";
  try {
    const contextCodec = createEmailOtpContextCodec(
      env.emailOtpContextSecret,
    );
    const context = contextCodec.read(verificationContext);
    if (!context) {
      result = { status: "invalid_email" } as const;
    } else {
      schoolId = context.schoolId;
      const service = await createProductionEmailOtpService();
      result = await service.verifyEmailCode(
        context.schoolId,
        context.email,
        code,
      );
    }
  } catch {
    result = { status: "temporarily_unavailable" } as const;
  }

  console.info(
    JSON.stringify({
      operation: "verify_email_code",
      outcome: result.status,
      requestId,
      schoolId,
    }),
  );

  return { ...result, message: VERIFY_MESSAGES[result.status] };
}
