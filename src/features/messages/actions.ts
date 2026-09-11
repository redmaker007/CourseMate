"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/features/auth/session";

import type { DirectMessageActionState } from "./message-action-state";
import { createProductionDirectMessageService } from "./production-direct-message-service";

function feedback(
  status: string,
  messageId?: string,
  throughMessageId?: string,
): DirectMessageActionState {
  const messages: Record<string, string> = {
    sent: "消息已发送。",
    updated: "已更新。",
    invalid_body: "消息正文必须为 1–4000 个字符。",
    invalid_conversation: "会话参数无效。",
    invalid_cursor: "消息位置无效。",
    not_allowed: "当前关系状态不允许发送消息。",
    not_available: "无法访问该会话。",
    onboarding_required: "请先完成个人资料。",
    temporarily_unavailable: "服务暂时不可用，请稍后重试。",
    unauthorized: "请先登录。",
  };
  return {
    status,
    message: messages[status] ?? "操作未完成，请稍后重试。",
    ...(messageId ? { messageId } : {}),
    ...(throughMessageId ? { throughMessageId } : {}),
  };
}

type AuthenticatedService =
  | {
      ok: true;
      service: Awaited<ReturnType<typeof createProductionDirectMessageService>>;
    }
  | { ok: false; error: "unauthorized" | "onboarding_required" };

async function authenticatedService(): Promise<AuthenticatedService> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "unauthorized" };
  if (!member.onboardingComplete) {
    return { ok: false, error: "onboarding_required" };
  }
  return { ok: true, service: await createProductionDirectMessageService() };
}

function refreshMessageSurfaces(conversationId: string) {
  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/dashboard");
  revalidatePath("/friends");
  revalidatePath("/friends/filtered");
}

export async function sendDirectMessageAction(
  _previousState: DirectMessageActionState,
  formData: FormData,
): Promise<DirectMessageActionState> {
  const authenticated = await authenticatedService();
  if (!authenticated.ok) return feedback(authenticated.error);
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "");
  const result = await authenticated.service.sendMessage(conversationId, body);
  if (result.status === "sent") refreshMessageSurfaces(conversationId);
  return feedback(
    result.status,
    "messageId" in result ? result.messageId : undefined,
  );
}

export async function markDirectMessageReadAction(
  conversationId: string,
  throughMessageId: string,
) {
  const authenticated = await authenticatedService();
  if (!authenticated.ok) return authenticated.error;
  const result = await authenticated.service.markRead(
    conversationId,
    throughMessageId,
  );
  if (result.status === "updated") refreshMessageSurfaces(conversationId);
  return result.status;
}

export async function clearDirectConversationAction(
  _previousState: DirectMessageActionState,
  formData: FormData,
): Promise<DirectMessageActionState> {
  const authenticated = await authenticatedService();
  if (!authenticated.ok) return feedback(authenticated.error);
  const conversationId = String(formData.get("conversationId") ?? "");
  const throughMessageId = String(formData.get("throughMessageId") ?? "");
  const result = await authenticated.service.clearConversation(
    conversationId,
    throughMessageId,
  );
  if (result.status === "updated") refreshMessageSurfaces(conversationId);
  return feedback(result.status, undefined, throughMessageId);
}
