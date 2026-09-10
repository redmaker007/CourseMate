"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/features/auth/session";

import type {
  FriendActionState,
  FriendSearchState,
} from "./friend-action-state";
import { createProductionFriendshipService } from "./production-friendship-service";

type MutationIntent =
  | "request"
  | "accept"
  | "reject"
  | "note"
  | "clear-note"
  | "hide"
  | "unhide"
  | "block"
  | "unblock"
  | "remove";

type SafeMutationResult = {
  status: string;
  fieldErrors?: { message?: string; note?: string };
};

function safeFieldErrors(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const errors = value as Record<string, unknown>;
  const safe = {
    ...(typeof errors.message === "string"
      ? { message: errors.message }
      : {}),
    ...(typeof errors.note === "string" ? { note: errors.note } : {}),
  };
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function safeMutationResult(value: unknown): SafeMutationResult {
  if (!value || typeof value !== "object") {
    return { status: "temporarily_unavailable" };
  }
  const result = value as Record<string, unknown>;
  return {
    status:
      typeof result.status === "string"
        ? result.status
        : "temporarily_unavailable",
    fieldErrors: safeFieldErrors(result.fieldErrors),
  };
}

function unavailable(): FriendActionState {
  return {
    status: "temporarily_unavailable",
    message: "好友功能暂时不可用，请稍后重试。",
  };
}

function unavailableSearch(): FriendSearchState {
  return {
    status: "temporarily_unavailable",
    message: "好友功能暂时不可用，请稍后重试。",
  };
}

function messageFor(intent: MutationIntent, status: string) {
  if (status === "temporarily_unavailable") {
    return "好友功能暂时不可用，请稍后重试。";
  }
  if (status === "onboarding_required") return "请先完成个人资料。";
  if (status === "unauthenticated") return "登录状态已失效，请重新登录。";
  if (status === "incoming_request") {
    return "对方已经申请你，请在收到的申请中接受或拒绝。";
  }
  if (status === "already_pending") return "好友申请已经发出。";
  if (status === "already_friends") return "你们已经是好友。";
  if (status === "blocked" || status === "not_available") {
    return intent === "request"
      ? "目前无法向该成员发送好友申请。"
      : "目前无法完成这项操作。";
  }
  if (status === "expired") return "这份好友申请已经过期。";
  if (status === "not_found" || status === "not_friends") {
    return "目标关系已发生变化，请刷新页面。";
  }
  if (status === "invalid" || status.startsWith("invalid_")) {
    return "请检查填写的内容。";
  }
  const messages: Partial<Record<MutationIntent, string>> = {
    request: "好友申请已发出。",
    accept: "已接受好友申请。",
    reject: "已拒绝好友申请。",
    note: "好友备注已保存。",
    "clear-note": "好友备注已清除。",
    hide: "已屏蔽该好友，对方不会收到提示。",
    unhide: "已解除屏蔽。",
    block: "已拉黑该成员，双方现在都不能发送消息。",
    unblock: "已解除你设置的拉黑。",
    remove: "好友关系已解除，双方的历史消息仍会保留。",
  };
  return messages[intent] ?? "操作已完成。";
}

function isSuccessful(status: string) {
  return ["sent", "accepted", "rejected", "saved", "cleared", "removed"].includes(
    status,
  );
}

async function hasCompleteSession() {
  const member = await getCurrentMember();
  return Boolean(member?.onboardingComplete);
}

export async function searchFriendAction(
  _previousState: FriendSearchState,
  formData: FormData,
): Promise<FriendSearchState> {
  if (!(await hasCompleteSession())) {
    return {
      status: "unauthenticated",
      message: "登录状态已失效，请重新登录。",
    };
  }

  try {
    const service = await createProductionFriendshipService();
    const result = await service.findMemberByEmail(
      String(formData.get("email") ?? ""),
    );
    switch (result.status) {
      case "found":
        return {
          status: "found",
          message: "找到同校成员。",
          member: result.member,
        };
      case "invalid":
        return { status: "invalid", message: "请输入完整、有效的邮箱地址。" };
      case "not_found":
        return { status: "not_found", message: "没有找到可添加的同校成员。" };
      case "rate_limited":
        return {
          status: "rate_limited",
          message: "搜索过于频繁，请稍后再试。",
        };
      case "onboarding_required":
        return {
          status: "onboarding_required",
          message: "请先完成个人资料。",
        };
      case "temporarily_unavailable":
        return unavailableSearch();
    }
  } catch {
    return unavailableSearch();
  }
}

function intentFrom(value: FormDataEntryValue | null): MutationIntent | null {
  const intent = String(value ?? "");
  const allowed: MutationIntent[] = [
    "request",
    "accept",
    "reject",
    "note",
    "clear-note",
    "hide",
    "unhide",
    "block",
    "unblock",
    "remove",
  ];
  return allowed.includes(intent as MutationIntent)
    ? (intent as MutationIntent)
    : null;
}

export async function friendMutationAction(
  _previousState: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  if (!(await hasCompleteSession())) {
    return {
      status: "unauthenticated",
      message: "登录状态已失效，请重新登录。",
    };
  }

  const intent = intentFrom(formData.get("intent"));
  if (!intent) {
    return { status: "invalid", message: "无法识别这项操作。" };
  }

  try {
    const service = await createProductionFriendshipService();
    const memberId = String(formData.get("memberId") ?? "");
    const requestId = String(formData.get("requestId") ?? "");
    let rawResult: unknown;
    switch (intent) {
      case "request":
        rawResult = await service.sendFriendRequest(
          memberId,
          String(formData.get("message") ?? ""),
        );
        break;
      case "accept":
      case "reject":
        rawResult = await service.respondToFriendRequest(requestId, intent);
        break;
      case "note":
        rawResult = await service.setFriendNote(
          memberId,
          String(formData.get("note") ?? ""),
        );
        break;
      case "clear-note":
        rawResult = await service.setFriendNote(memberId, "");
        break;
      case "hide":
      case "unhide":
        rawResult = await service.setFriendHidden(memberId, intent === "hide");
        break;
      case "block":
      case "unblock":
        rawResult = await service.setMemberBlocked(
          memberId,
          intent === "block",
        );
        break;
      case "remove":
        rawResult = await service.removeFriend(memberId);
        break;
    }

    const result = safeMutationResult(rawResult);
    const state: FriendActionState = {
      status: result.status,
      message: messageFor(intent, result.status),
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
    if (isSuccessful(result.status)) {
      revalidatePath("/friends");
      revalidatePath("/friends/filtered");
    }
    return state;
  } catch {
    return unavailable();
  }
}
