"use server";

import { revalidatePath } from "next/cache";

import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

import { createEmailOtpContextCodec } from "./email-otp-context";
import {
  createPasswordSetupService,
  createPasswordSignInService,
  PASSWORD_MIN_LENGTH,
} from "./password-service";
import type {
  PasswordSignInActionState,
  RequestPasswordCodeActionState,
  SetPasswordActionState,
} from "./password-states";
import { getCurrentMember } from "./session";
import { createSupabaseMemberSessionReader } from "./supabase-email-otp-adapters";
import {
  createSupabasePasswordSetup,
  createSupabasePasswordSignIn,
  toMemberAccessStatus,
} from "./supabase-password-adapters";

const SIGN_IN_MESSAGES: Record<Exclude<PasswordSignInActionState["status"], "idle">, string> = {
  signed_in: "登录成功。",
  already_signed_in: "你已经登录。",
  invalid_credentials: "邮箱或密码不正确。还没设置过密码的话，请先用验证码登录。",
  reverification_required: "距上次邮箱验证已超过 30 天，请用验证码登录一次，之后可以继续用密码。",
  rate_limited: "操作过于频繁，请稍后再试。",
  temporarily_unavailable: "服务暂时不可用，请稍后重试。",
};

export async function signInWithPasswordAction(
  _previousState: PasswordSignInActionState,
  formData: FormData,
): Promise<PasswordSignInActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const requestId = crypto.randomUUID();

  let result;
  try {
    const supabase = await createClient();
    const reader = createSupabaseMemberSessionReader(supabase);
    result = await createPasswordSignInService({
      auth: createSupabasePasswordSignIn(supabase),
      readAccess: async () => toMemberAccessStatus(await reader.getMemberAccess()),
    }).signIn(email, password);
  } catch {
    result = { status: "temporarily_unavailable" } as const;
  }

  console.info(JSON.stringify({ operation: "password_sign_in", outcome: result.status, requestId }));
  return { ...result, message: SIGN_IN_MESSAGES[result.status], email: email.trim().slice(0, 254) };
}

const REQUEST_MESSAGES: Record<Exclude<RequestPasswordCodeActionState["status"], "idle">, string> = {
  code_sent: "验证码已发送，请检查收件箱和垃圾邮件。",
  unauthenticated: "登录状态已失效，请重新登录。",
  rate_limited: "操作过于频繁，请稍后再试。",
  send_failed: "验证码发送失败，请稍后重试。",
  temporarily_unavailable: "服务暂时不可用，请稍后重试。",
};

// useActionState 会传入上一次的状态；发码不依赖它，所以不声明参数。
export async function requestPasswordCodeAction(): Promise<RequestPasswordCodeActionState> {
  const member = await getCurrentMember();
  if (!member) return { status: "unauthenticated", message: REQUEST_MESSAGES.unauthenticated };

  let state: RequestPasswordCodeActionState;
  try {
    const codec = createEmailOtpContextCodec(serverEnv.emailOtpContextSecret);
    const result = await createPasswordSetupService(
      createSupabasePasswordSetup(await createClient()),
    ).requestCode(member);
    state = result.status === "code_sent"
      ? {
          ...result,
          flowId: crypto.randomUUID(),
          verificationContext: codec.issue({
            schoolId: member.homeSchoolId ?? member.schoolId,
            email: member.email,
          }),
          message: REQUEST_MESSAGES.code_sent,
        }
      : { ...result, message: REQUEST_MESSAGES[result.status] };
  } catch {
    state = { status: "temporarily_unavailable", message: REQUEST_MESSAGES.temporarily_unavailable };
  }

  console.info(JSON.stringify({ operation: "request_password_code", outcome: state.status, requestId: crypto.randomUUID() }));
  return state;
}

const SET_MESSAGES: Record<Exclude<SetPasswordActionState["status"], "idle">, string> = {
  password_set: "密码已设置。以后可以用学校邮箱和这个密码登录。",
  unauthenticated: "登录状态已失效，请重新登录。",
  invalid_context: "验证码已失效，请重新发送。",
  invalid_or_expired_code: "验证码错误或已过期，请检查后重试。",
  weak_password: `密码至少 ${PASSWORD_MIN_LENGTH} 位，最长 72 个英文字符。`,
  password_mismatch: "两次输入的密码不一致。",
  rate_limited: "操作过于频繁，请稍后再试。",
  temporarily_unavailable: "服务暂时不可用，请稍后重试。",
};

export async function setPasswordAction(
  _previousState: SetPasswordActionState,
  formData: FormData,
): Promise<SetPasswordActionState> {
  const member = await getCurrentMember();
  if (!member) return { status: "unauthenticated", message: SET_MESSAGES.unauthenticated };

  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirmPassword") ?? "")) {
    return { status: "password_mismatch", message: SET_MESSAGES.password_mismatch };
  }

  let status: Exclude<SetPasswordActionState["status"], "idle">;
  try {
    const codec = createEmailOtpContextCodec(serverEnv.emailOtpContextSecret);
    const context = codec.read(String(formData.get("verificationContext") ?? ""));
    status = context
      ? (await createPasswordSetupService(createSupabasePasswordSetup(await createClient())).setPassword(
          member,
          { contextEmail: context.email, code: String(formData.get("code") ?? ""), password },
        )).status
      : "invalid_context";
  } catch {
    status = "temporarily_unavailable";
  }

  console.info(JSON.stringify({ operation: "set_password", outcome: status, requestId: crypto.randomUUID() }));
  if (status === "password_set") revalidatePath("/profile");
  return { status, message: SET_MESSAGES[status] };
}
