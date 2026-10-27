import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberAccess } from "./member-session";
import type { MemberAccessStatus, PasswordSetupPort, PasswordSignInPort } from "./password-service";
import { createSupabaseCurrentDeviceSession } from "./supabase-current-device-session";
import { classifyAuthError, createSupabaseEmailOtpAuth } from "./supabase-email-otp-adapters";

export function toMemberAccessStatus(access: MemberAccess): MemberAccessStatus {
  return access?.status ?? "none";
}

export function createSupabasePasswordSignIn(supabase: SupabaseClient): PasswordSignInPort {
  const currentDeviceSession = createSupabaseCurrentDeviceSession(supabase);
  return {
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return { status: "signed_in" };
      // 没设密码、密码错、邮箱未确认都归为同一结果。
      return classifyAuthError(error, "invalid_credentials");
    },
    async discardSession() {
      await currentDeviceSession.signOut();
    },
  };
}

/**
 * 设置密码：在给定客户端上验码 → 登记验证时间 → 改密码 → 登记密码指纹。
 *
 * Supabase 改密码时会撤销该账号的其他所有会话，所以验码得到的新会话就是本设备之后要用的会话：
 * 网页传入写 Cookie 的客户端，新会话直接替换浏览器里的旧会话；移动接口传入独立客户端，
 * 成功后把新凭据交给 App，失败时由调用方退出这个新会话。
 */
export function createSupabasePasswordSetup(client: SupabaseClient): PasswordSetupPort {
  return {
    async requestCode(email) {
      return createSupabaseEmailOtpAuth(client).requestCode(email);
    },

    async setPassword({ email, code, password, expectedUserId }) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) return classifyAuthError(error, "invalid_or_expired");
      if (data.user?.id !== expectedUserId) {
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        return { status: "unavailable" };
      }

      const recorded = await client.rpc("record_email_verification");
      if (recorded.error) return { status: "unavailable" };

      const updated = await client.auth.updateUser({ password });
      // 新旧密码相同时 Auth 不改哈希，照样登记当前哈希即可。
      if (updated.error && updated.error.code !== "same_password") {
        if (updated.error.code === "weak_password") return { status: "weak_password" };
        return classifyAuthError(updated.error, "unavailable");
      }

      const registered = await client.rpc("record_password_set");
      if (registered.error) return { status: "unavailable" };
      return { status: "password_set" };
    },
  };
}

export async function readOwnPasswordStatus(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("own_password_status");
  if (error) throw error;
  return data === true;
}
