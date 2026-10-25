import { isAuthError, type SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseProfileService } from "@/features/profile/supabase-profile-service";
import { handleMobileCourseRequest, mobileCourseMethods } from "@/features/courses/mobile-api";
import type { Database } from "@/types/database";
import { handleMobileFriendRequest, mobileFriendMethods, mobileFriendHttpStatus } from "@/features/friends/mobile-api";
import { handleMobileMessageRequest, mobileMessageMethods, mobileMessageHttpStatus } from "@/features/messages/mobile-api";
import { handleMobileReportRequest, mobileReportMethods, mobileReportHttpStatus } from "@/features/reporting/mobile-api";

import type { createEmailOtpContextCodec } from "./email-otp-context";
import { createEmailOtpService } from "./email-otp-service";
import { createSignOutService } from "./sign-out-service";
import { createSupabaseEmailOtpAuth, createSupabaseMemberSessionReader, createSupabaseSchoolDirectory } from "./supabase-email-otp-adapters";

export const MOBILE_API_PREFIX = "/api/mobile/v1/";
const MAX_BODY_BYTES = 16_384;
const methods: Record<string, string[]> = {
  schools: ["GET"],
  "auth/request-code": ["POST"],
  "auth/verify-code": ["POST"],
  "auth/refresh": ["POST"],
  "auth/sign-out": ["POST"],
  session: ["GET"],
  profile: ["GET", "PATCH"],
};

type Dependencies = {
  createClient(accessToken?: string): SupabaseClient<Database>;
  getCodec(): ReturnType<typeof createEmailOtpContextCodec>;
  onFriendRequestSent?(requestId: string): void;
  onDirectMessageSent?(messageId: string, conversationId: string): void;
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache", "x-content-type-options": "nosniff", ...headers },
  });
}

class RequestFailure extends Error {
  constructor(readonly status: string, readonly httpStatus: number) { super(status); }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestFailure("unsupported_media_type", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestFailure("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestFailure("request_too_large", 413);
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new RequestFailure("invalid_request", 400); }
}

function fields(body: Record<string, unknown>, names: string[]) {
  if (Object.keys(body).some((key) => !names.includes(key)) || names.some((key) => typeof body[key] !== "string")) {
    throw new RequestFailure("invalid_request", 400);
  }
  return body as Record<string, string>;
}

function resultHttpStatus(status: string) {
  if (status === "temporarily_unavailable" || status === "send_failed") return 503;
  if (status === "rate_limited") return 429;
  if (["invalid_email", "invalid_or_expired_code", "invalid"].includes(status)) return 400;
  if (status === "unauthenticated") return 401;
  if (status === "onboarding_required") return 403;
  if (status === "invalid_request") return 400;
  if (status === "not_available") return 404;
  return 200;
}

export function createMobileAuthApi(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const pathname = new URL(request.url).pathname;
      const path = pathname.startsWith(MOBILE_API_PREFIX) ? pathname.slice(MOBILE_API_PREFIX.length) : "";
      const courseMethods = mobileCourseMethods(path);
      const friendMethods = mobileFriendMethods(path);
      const messageMethods = mobileMessageMethods(path);
      const reportMethods = mobileReportMethods(path);
      const allowed = reportMethods ?? messageMethods ?? friendMethods ?? courseMethods ?? (Object.hasOwn(methods, path) ? methods[path] : undefined);
      if (!allowed) return json({ status: "not_found" }, 404);
      if (!allowed.includes(request.method)) return json({ status: "method_not_allowed" }, 405, { allow: allowed.join(", ") });

      // 刷新只消费 refreshToken；过期 Bearer 不能覆盖 SDK 刚取得的新会话。
      const authorization = path === "auth/refresh" ? null : request.headers.get("authorization");
      const accessToken = authorization?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1];
      if (authorization && !accessToken) return json({ status: "access_token_invalid" }, 401);
      const protectedPath = courseMethods !== undefined || friendMethods !== undefined || messageMethods !== undefined || reportMethods !== undefined || ["session", "profile", "auth/sign-out"].includes(path);
      if (protectedPath && !accessToken) return json({ status: "authentication_required" }, 401);
      const body = request.method === "GET" ? {} : await readBody(request);
      const codePath = path === "auth/request-code" || path === "auth/verify-code";
      if (codePath && accessToken) {
        const current = await createSupabaseMemberSessionReader(dependencies.createClient(accessToken), accessToken).getMemberSession();
        if (current) return json({ status: "already_signed_in" });
      }
      // 发码／验码用独立匿名实例，不能让旧 Bearer 覆盖新验证出的身份。
      const supabase = dependencies.createClient(codePath ? undefined : accessToken);
      const reader = createSupabaseMemberSessionReader(supabase, codePath ? undefined : accessToken);
      const readMember = async () => {
        const member = await reader.getMemberContext();
        if (!member) throw new RequestFailure("membership_denied", 403);
        return member;
      };

      if (path === "schools") {
        const { data, error } = await supabase.from("schools").select("id, name_en, name_zh, school_email_domains(domain)").order("name_en");
        if (error) throw error;
        return json({ status: "ok", schools: (data ?? []).map((school) => ({
          id: school.id, nameEn: school.name_en, nameZh: school.name_zh,
          emailDomains: school.school_email_domains.map((row: { domain: string }) => row.domain).sort((a: string, b: string) => a.length - b.length || a.localeCompare(b)),
        })) });
      }

      const sessionReply = async (status: "signed_in" | "refreshed", member?: Awaited<ReturnType<typeof readMember>>) => {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session?.expires_at) throw error ?? new Error("Missing session");
        const session = data.session;
        return json({ status, ...(member ? { member } : {}), session: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          tokenType: session.token_type,
        } });
      };

      if (path === "auth/request-code" || path === "auth/verify-code") {
        const service = createEmailOtpService({
          auth: createSupabaseEmailOtpAuth(supabase),
          schools: createSupabaseSchoolDirectory(supabase),
          memberSession: { hasValidMemberSession: async () => (await reader.getMemberSession()) !== null },
        });
        if (path === "auth/request-code") {
          const input = fields(body, ["schoolId", "email"]);
          if (!input.schoolId || input.schoolId.length > 100) return json({ status: "invalid_email" }, 400);
          const codec = dependencies.getCodec();
          const result = await service.requestEmailCode(input.schoolId, input.email);
          if (result.status === "code_sent") return json({ ...result, context: codec.issue(result), resendAfterSeconds: 60 });
          return json(result, resultHttpStatus(result.status));
        }
        const input = fields(body, ["context", "code"]);
        const context = dependencies.getCodec().read(input.context);
        if (!context) return json({ status: "invalid_or_expired_context" }, 400);
        const result = await service.verifyEmailCode(context.schoolId, context.email, input.code);
        if (result.status !== "signed_in") return json(result, resultHttpStatus(result.status));
        try { return await sessionReply("signed_in", await readMember()); }
        catch (error) {
          await supabase.auth.signOut({ scope: "local" });
          throw error;
        }
      }

      if (path === "auth/refresh") {
        const input = fields(body, ["refreshToken"]);
        if (!input.refreshToken) return json({ status: "invalid_request" }, 400);
        const { error } = await supabase.auth.refreshSession({ refresh_token: input.refreshToken });
        if (error) {
          if (["validation_failed", "refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "user_not_found", "user_banned"].includes(error.code ?? "")) return json({ status: "session_invalid" }, 401);
          if (error.status === 429) return json({ status: "rate_limited" }, 429);
          throw error;
        }
        // 先交付轮换后的凭据，客户端再 GET session 校验成员；临时读取失败不能丢失新 refreshToken。
        return await sessionReply("refreshed");
      }

      if (path === "auth/sign-out") {
        fields(body, []);
        // SDK 的 admin.signOut 使用传入的用户 JWT 调用 /logout；不使用 service_role。
        const service = createSignOutService({ signOut: async () => {
          const { error } = await supabase.auth.admin.signOut(accessToken!, "local");
          if (error) throw error;
        } });
        const result = await service.signOutCurrentDevice();
        return json(result, resultHttpStatus(result.status));
      }

      const member = await readMember();
      if (reportMethods) {
        const result = await handleMobileReportRequest(request, body, supabase, member);
        return json(result, mobileReportHttpStatus(result.status));
      }
      if (messageMethods) {
        const result = await handleMobileMessageRequest(request, path, body, supabase, member, dependencies.onDirectMessageSent);
        return json(result, mobileMessageHttpStatus(result.status));
      }
      if (friendMethods) {
        const result = await handleMobileFriendRequest(request, path, body, supabase, member, dependencies.onFriendRequestSent);
        return json(result, mobileFriendHttpStatus(result.status));
      }
      if (courseMethods) {
        const result = await handleMobileCourseRequest(request, path, body, supabase, member);
        return json(result, resultHttpStatus(result.status));
      }
      if (path === "session") return json({ status: "ok", member });
      if (request.method === "PATCH") {
        const input = fields(body, ["displayName", "major", "gradYear"]);
        const result = await createSupabaseProfileService(supabase, async () => member).saveProfile({ displayName: input.displayName, major: input.major, gradYear: input.gradYear });
        return json(result, resultHttpStatus(result.status));
      }
      const { data, error } = await supabase.rpc("get_own_profile");
      if (error) throw error;
      const row = data?.[0];
      if (row && row.id !== member.userId) throw new Error("Invalid own profile response");
      return json({ status: "ok", profile: row ? { displayName: row.display_name, major: row.major, gradYear: row.grad_year, avatarUrl: row.avatar_url } : null });
    } catch (error) {
      if (error instanceof RequestFailure) return json({ status: error.status }, error.httpStatus);
      if (isAuthError(error) && (error.name === "AuthInvalidJwtError" || error.name === "AuthSessionMissingError" || ["bad_jwt", "session_not_found", "user_not_found"].includes(error.code ?? ""))) {
        return json({ status: "access_token_invalid" }, 401);
      }
      return json({ status: "temporarily_unavailable" }, 503);
    }
  };
}
