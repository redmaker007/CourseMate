import type { AuthCodeRequestResult } from "./email-otp-service";
import { normalizeSchoolEmail } from "./email-otp-service";

/**
 * 密码登录与设置密码（ADR-0011）。
 *
 * 密码只是已有成员账号的第二种登录方式：首次登录、设置／修改密码、每 30 天一次都必须
 * 用验证码。这里只放业务规则，Supabase 调用经端口注入，网页与移动接口共用。
 */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt 只取前 72 字节，超出部分不参与比对，所以直接拒绝。 */
export const PASSWORD_MAX_BYTES = 72;

export function isAcceptablePassword(password: string) {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES
  );
}

export type MemberAccessStatus = "member" | "reverification_required" | "none";

export interface PasswordSignInPort {
  signIn(
    email: string,
    password: string,
  ): Promise<{ status: "signed_in" | "invalid_credentials" | "rate_limited" | "unavailable" }>;
  discardSession(): Promise<void>;
}

export type PasswordSignInResult =
  | { status: "signed_in" }
  | { status: "already_signed_in" }
  | { status: "invalid_credentials" }
  | { status: "reverification_required" }
  | { status: "rate_limited" }
  | { status: "temporarily_unavailable" };

export function createPasswordSignInService(dependencies: {
  auth: PasswordSignInPort;
  readAccess(): Promise<MemberAccessStatus>;
}) {
  return {
    async signIn(email: string, password: string): Promise<PasswordSignInResult> {
      try {
        if ((await dependencies.readAccess()) === "member") {
          return { status: "already_signed_in" };
        }
        const normalized = normalizeSchoolEmail(email);
        // 格式不对与密码错误给同一个结果，不透露账号是否存在。
        if (!normalized || !password || new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
          return { status: "invalid_credentials" };
        }

        const result = await dependencies.auth.signIn(normalized.email, password);
        if (result.status === "rate_limited") return { status: "rate_limited" };
        if (result.status === "unavailable") return { status: "temporarily_unavailable" };
        if (result.status === "invalid_credentials") return { status: "invalid_credentials" };

        let access: MemberAccessStatus;
        try {
          access = await dependencies.readAccess();
        } catch {
          await dependencies.auth.discardSession();
          return { status: "temporarily_unavailable" };
        }
        if (access === "member") return { status: "signed_in" };
        // 不留下这次的密码会话：要么该用验证码重新验证，要么已不是可用成员。
        await dependencies.auth.discardSession();
        return access === "reverification_required"
          ? { status: "reverification_required" }
          : { status: "invalid_credentials" };
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}

export interface PasswordSetupPort {
  requestCode(email: string): Promise<AuthCodeRequestResult>;
  /** 用临时会话验码并改密码；验出的用户必须是 expectedUserId。 */
  setPassword(input: {
    email: string;
    code: string;
    password: string;
    expectedUserId: string;
  }): Promise<{
    status: "password_set" | "invalid_or_expired" | "weak_password" | "rate_limited" | "unavailable";
  }>;
}

export type PasswordCodeRequestResult =
  | { status: "code_sent"; email: string }
  | { status: "rate_limited" }
  | { status: "send_failed" }
  | { status: "temporarily_unavailable" };

export type SetPasswordResult =
  | { status: "password_set" }
  | { status: "invalid_context" }
  | { status: "invalid_or_expired_code" }
  | { status: "weak_password" }
  | { status: "rate_limited" }
  | { status: "temporarily_unavailable" };

/** member 必须来自服务端已校验的当前会话；验证码只发给它的邮箱。 */
export function createPasswordSetupService(port: PasswordSetupPort) {
  return {
    async requestCode(member: { email: string }): Promise<PasswordCodeRequestResult> {
      try {
        const result = await port.requestCode(member.email);
        switch (result.status) {
          case "accepted":
            return { status: "code_sent", email: member.email };
          case "rate_limited":
            return { status: "rate_limited" };
          case "delivery_failed":
            return { status: "send_failed" };
          case "unavailable":
            return { status: "temporarily_unavailable" };
        }
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },

    async setPassword(
      member: { userId: string; email: string },
      input: { contextEmail: string; code: string; password: string },
    ): Promise<SetPasswordResult> {
      // 验证码上下文必须是发给当前账号的；换了账号或伪造的上下文一律拒绝。
      if (input.contextEmail !== member.email) return { status: "invalid_context" };
      const code = input.code.trim();
      if (!/^\d{6}$/.test(code)) return { status: "invalid_or_expired_code" };
      if (!isAcceptablePassword(input.password)) return { status: "weak_password" };

      try {
        const result = await port.setPassword({
          email: member.email,
          code,
          password: input.password,
          expectedUserId: member.userId,
        });
        switch (result.status) {
          case "password_set":
            return { status: "password_set" };
          case "invalid_or_expired":
            return { status: "invalid_or_expired_code" };
          case "weak_password":
            return { status: "weak_password" };
          case "rate_limited":
            return { status: "rate_limited" };
          case "unavailable":
            return { status: "temporarily_unavailable" };
        }
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}
