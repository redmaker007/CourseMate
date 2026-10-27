import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberContext } from "@/features/auth/member-session";
import { readMobilePagination } from "@/lib/mobile-pagination";
import type { Database } from "@/types/database";
import { createFriendshipService } from "./friendship-service";
import { createSupabaseFriendBackend, type FriendshipRpcClient } from "./supabase-friend-backend";

export function mobileFriendMethods(path: string) {
  if (path === "friends" || path === "friends/blocked") return ["GET"];
  if (path === "friends/search") return ["POST"];
  if (path === "friend-requests") return ["GET", "POST"];
  if (/^friends\/[^/]+$/.test(path)) return ["GET"];
  if (/^friend-requests\/[^/]+\/respond$/.test(path) || /^friends\/[^/]+\/(note|hide|block|remove)$/.test(path)) return ["POST"];
  return undefined;
}

function validBody(body: Record<string, unknown>, fields: Record<string, "string" | "boolean">) {
  return Object.keys(body).every(key => Object.hasOwn(fields, key))
    && Object.entries(fields).every(([key, type]) => typeof body[key] === type);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const failures = ["invalid", "invalid_target", "invalid_request", "not_available", "not_found", "not_friends", "not_recipient", "blocked", "rate_limited", "onboarding_required", "temporarily_unavailable"];

function mutationResult(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object") return { status: "temporarily_unavailable" };
  const row = value as Record<string, unknown>;
  if (typeof row.status !== "string" || !allowed.includes(row.status)
    || (row.requestId !== undefined && !isUuid(row.requestId))
    || (row.conversationId !== undefined && !isUuid(row.conversationId))
    || (row.status === "sent" && !isUuid(row.requestId))
    || (row.status === "accepted" && !isUuid(row.conversationId))) return { status: "temporarily_unavailable" };
  const errors = row.fieldErrors && typeof row.fieldErrors === "object" ? row.fieldErrors as Record<string, unknown> : {};
  const fieldErrors = {
    ...(typeof errors.message === "string" ? { message: errors.message } : {}),
    ...(typeof errors.note === "string" ? { note: errors.note } : {}),
  };
  return { status: row.status,
    ...(isUuid(row.requestId) ? { requestId: row.requestId } : {}),
    ...(isUuid(row.conversationId) ? { conversationId: row.conversationId } : {}),
    ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
  };
}

export function mobileFriendHttpStatus(status: string) {
  if (["loaded", "found", "sent", "accepted", "rejected", "saved", "cleared", "removed"].includes(status)) return 200;
  if (["invalid", "invalid_target", "invalid_request"].includes(status)) return 400;
  if (["onboarding_required", "blocked", "not_recipient"].includes(status)) return 403;
  if (["not_found", "not_available", "not_friends"].includes(status)) return 404;
  if (["already_pending", "incoming_request", "already_friends", "expired"].includes(status)) return 409;
  if (status === "rate_limited") return 429;
  return 503;
}

export async function handleMobileFriendRequest(
  request: Request,
  path: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
  member: MemberContext,
  onFriendRequestSent?: (requestId: string) => void,
) {
  if (!member.onboardingComplete) return { status: "onboarding_required" } as const;
  const params = new URL(request.url).searchParams;
  const post = request.method === "POST";
  const detail = !post && path !== "friends" && path !== "friends/blocked" && path !== "friend-requests";
  const targetId = detail ? path.split("/")[1] : null;
  if (detail && !isUuid(targetId)) return { status: "invalid_request" };
  const allowed = post || detail ? [] : path === "friends" ? ["scope", "limit", "offset"]
    : path === "friend-requests" ? ["direction", "status", "limit", "offset"] : ["limit", "offset"];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) return { status: "invalid_request" } as const;
  const page = readMobilePagination(params);
  const scope = params.get("scope") ?? "visible";
  const direction = params.get("direction") ?? "all";
  const status = params.get("status") ?? "all";
  if (!page || !["visible", "hidden"].includes(scope) || !["all", "incoming", "outgoing"].includes(direction)
    || !["all", "pending", "accepted", "rejected", "expired"].includes(status)) return { status: "invalid_request" } as const;
  const pageInfo = (length: number) => ({ ...page, nextOffset: length > page.limit ? page.offset + page.limit : null });
  const invokeRpc = supabase.rpc.bind(supabase) as unknown as FriendshipRpcClient["rpc"];
  const service = createFriendshipService(createSupabaseFriendBackend({
    async rpc(name, args) {
      let result;
      if (name === "list_friends") {
        const query = supabase.rpc("list_friends", { include_hidden: detail || scope === "hidden" });
        result = detail ? await query.eq("member_id", targetId!).limit(1)
          : await query.eq("hidden", scope === "hidden").order("effective_name").order("member_id").range(page.offset, page.offset + page.limit);
      } else if (name === "list_friend_requests") {
        let query = supabase.rpc("list_friend_requests");
        if (direction !== "all") query = query.eq("direction", direction);
        if (status !== "all") query = query.eq("status", status);
        result = await query.order("created_at", { ascending: false }).order("request_id", { ascending: false }).range(page.offset, page.offset + page.limit);
      } else if (name === "list_blocked_members") {
        result = await supabase.rpc("list_blocked_members").order("display_name").order("member_id").range(page.offset, page.offset + page.limit);
      } else result = await invokeRpc(name, args);
      if (name.startsWith("list_") && !result.error && !Array.isArray(result.data)) throw new Error("Invalid friend list response");
      return result;
    },
  }));
  if (post) {
    if (path === "friends/search") {
      if (!validBody(body, { email: "string" })) return { status: "invalid_request" };
      const result = await service.findMemberByEmail(String(body.email));
      if (result.status === "found") {
        const found = result.member;
        if (!isUuid(found.memberId) || !["none", "outgoing_request", "incoming_request", "friend", "blocked"].includes(found.relationship)
          || !["none", "blocked_by_me", "blocked_by_other", "mutual"].includes(found.blockStatus)
          || (found.incomingRequestId !== null && !isUuid(found.incomingRequestId))) return { status: "temporarily_unavailable" };
      } else if (!["not_found", "rate_limited", "onboarding_required", "invalid", "temporarily_unavailable"].includes(result.status)) return { status: "temporarily_unavailable" };
      return result;
    }
    if (path !== "friend-requests") {
      const [, targetId, action] = path.split("/");
      if (!isUuid(targetId)) return { status: "invalid_request" };
      if (action === "respond") {
        if (!validBody(body, { decision: "string" }) || (body.decision !== "accept" && body.decision !== "reject")) return { status: "invalid_request" };
        return mutationResult(await service.respondToFriendRequest(targetId, body.decision), [...failures, "accepted", "rejected", "expired"]);
      }
      if (action === "note") {
        if (!validBody(body, { note: "string" })) return { status: "invalid_request" };
        return mutationResult(await service.setFriendNote(targetId, String(body.note)), [...failures, "saved", "cleared"]);
      }
      if (action === "hide") {
        if (!validBody(body, { hidden: "boolean" })) return { status: "invalid_request" };
        return mutationResult(await service.setFriendHidden(targetId, body.hidden as boolean), [...failures, "saved"]);
      }
      if (action === "block") {
        if (!validBody(body, { blocked: "boolean" })) return { status: "invalid_request" };
        return mutationResult(await service.setMemberBlocked(targetId, body.blocked as boolean), [...failures, "saved", "cleared"]);
      }
      if (!validBody(body, {})) return { status: "invalid_request" };
      return mutationResult(await service.removeFriend(targetId), [...failures, "removed"]);
    }
    if (!validBody(body, { memberId: "string", message: "string" })) return { status: "invalid_request" };
    const result = mutationResult(await service.sendFriendRequest(String(body.memberId), String(body.message)),
      [...failures, "sent", "already_pending", "incoming_request", "already_friends"]);
    if (result.status === "sent" && "requestId" in result && result.requestId) {
      try { onFriendRequestSent?.(result.requestId); } catch { /* 推送失败不能改变申请结果。 */ }
    }
    return result;
  }
  if (path === "friend-requests") {
    const result = await service.listFriendRequests();
    return result.status !== "loaded" ? result : { status: "loaded", schoolId: member.currentSchoolId,
      requests: result.requests.slice(0, page.limit), page: pageInfo(result.requests.length) };
  }
  if (path === "friends/blocked") {
    const result = await service.listBlockedMembers();
    return result.status !== "loaded" ? result : { status: "loaded", schoolId: member.currentSchoolId,
      members: result.members.slice(0, page.limit), page: pageInfo(result.members.length) };
  }
  const result = await service.listFriends(detail || scope === "hidden");
  if (result.status !== "loaded") return result;
  if (detail) return result.friends[0] ? { status: "found", friend: result.friends[0] } : { status: "not_friends" };
  return { status: "loaded", schoolId: member.currentSchoolId, friends: result.friends.slice(0, page.limit),
    page: pageInfo(result.friends.length),
  };
}
