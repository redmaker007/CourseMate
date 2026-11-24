import { handleMobileDeletionRequest, type DeletionDependencies } from "./account-deletion-api";
import type { WebDeletionState } from "./web-account-deletion-state";

export type { WebDeletionState };

/**
 * 网页端永久注销。复用移动端同一套服务端流程（handleMobileDeletionRequest）：
 * 向 Auth 重新确认账号 → 发验证码 → 签名确认 + 随机回执 → service_role 专用 RPC 一次事务删除。
 * 网页只是换了身份来源：Bearer 令牌取自当前浏览器会话，而不是 App 传来的请求头。
 */

const MESSAGES: Record<string, string> = {
  code_sent: "验证码已发送到你的学校邮箱，10 分钟内有效。",
  completed: "账号已永久注销。",
  invalid_request: "请输入 6 位验证码，并勾选“我已了解注销后无法恢复”。",
  invalid_or_expired_code: "验证码错误或已过期。",
  invalid_challenge: "确认已过期，请重新发送验证码。",
  identity_mismatch: "账号状态已变化，请重新登录后再试。",
  authentication_required: "登录已失效，请重新登录后再试。",
  access_token_invalid: "登录已失效，请重新登录后再试。",
  not_available: "登录已失效，请重新登录后再试。",
  owner_transfer_required: "你是平台所有者，需要先把所有者身份转给别人才能注销。",
  storage_cleanup_required: "账号还有未清理的文件，请联系我们处理后再注销。",
  rate_limited: "操作过于频繁，请稍后再试。",
  temporarily_unavailable: "服务暂时不可用，请稍后在本页重试。",
};

// 这些结果下原确认仍然有效，保留令牌，让用户改正或重试；重试时服务端先按回执判断是否其实已完成。
const KEEP_TOKENS = new Set(["invalid_request", "invalid_or_expired_code", "rate_limited", "temporarily_unavailable"]);

const internalUrl = (path: string) => new Request(`https://coursemate.internal/api/mobile/v1/${path}`, { method: "POST" });

function toState(result: Record<string, unknown>, previous?: WebDeletionState): WebDeletionState {
  const status = typeof result.status === "string" ? result.status : "temporarily_unavailable";
  const state: WebDeletionState = { status, message: MESSAGES[status] ?? MESSAGES.temporarily_unavailable };
  if (status === "code_sent" && typeof result.challengeToken === "string" && typeof result.receiptToken === "string") {
    return { ...state, challengeToken: result.challengeToken, receiptToken: result.receiptToken };
  }
  if (KEEP_TOKENS.has(status) && previous?.challengeToken && previous.receiptToken) {
    return { ...state, challengeToken: previous.challengeToken, receiptToken: previous.receiptToken };
  }
  return state;
}

export async function requestWebDeletionCode(accessToken: string | undefined, dependencies: DeletionDependencies) {
  try {
    return toState(await handleMobileDeletionRequest(internalUrl("account/deletion/challenge"), "account/deletion/challenge", {}, accessToken, dependencies));
  } catch {
    return toState({ status: "temporarily_unavailable" });
  }
}

export async function confirmWebDeletion(
  accessToken: string | undefined,
  input: { challengeToken: string; receiptToken: string; code: string; confirmed: boolean },
  dependencies: DeletionDependencies,
) {
  const previous: WebDeletionState = { status: "code_sent", message: "", challengeToken: input.challengeToken, receiptToken: input.receiptToken };
  try {
    const result = await handleMobileDeletionRequest(internalUrl("account/deletion"), "account/deletion", {
      challengeToken: input.challengeToken,
      receiptToken: input.receiptToken,
      code: input.code.trim(),
      confirmation: input.confirmed ? "DELETE" : "",
    }, accessToken, dependencies);
    return toState(result, previous);
  } catch {
    return toState({ status: "temporarily_unavailable" }, previous);
  }
}
