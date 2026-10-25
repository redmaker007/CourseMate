import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberContext } from "@/features/auth/member-session";
import { readMobilePagination } from "@/lib/mobile-pagination";
import type { Database } from "@/types/database";
import { isUuid } from "@/features/courses/course-identifiers";
import { isMobileMessageId, readMobileConversation, readMobileConversationState, readMobileMessages } from "./mobile-message-data";
import { sendSupabaseConversationMessage } from "./supabase-conversation-message";
import { createDirectMessageService } from "./direct-message-service";
import { createSupabaseDirectMessageBackend, type DirectMessageRpcClient } from "./supabase-direct-message-backend";

export function mobileMessageMethods(path: string) {
  if (path === "conversations" || path === "conversations/unread") return ["GET"];
  if (/^conversations\/[^/]+$/.test(path)) return ["GET"];
  if (/^conversations\/[^/]+\/messages$/.test(path)) return ["GET", "POST"];
  if (/^conversations\/[^/]+\/(read|clear|reconcile)$/.test(path)) return ["POST"];
  return undefined;
}

export function mobileMessageHttpStatus(status: string) {
  if (["loaded", "sent", "sent_not_visible", "updated", "reconciled"].includes(status)) return 200;
  if (["invalid_request", "invalid_body", "invalid_cursor"].includes(status)) return 400;
  if (["onboarding_required", "not_allowed"].includes(status)) return 403;
  if (status === "not_available") return 404;
  if (status === "idempotency_conflict") return 409;
  return 503;
}

export async function handleMobileMessageRequest(
  request: Request,
  path: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
  member: MemberContext,
  onDirectMessageSent?: (messageId: string, conversationId: string) => void,
) {
  if (!member.onboardingComplete) return { status: "onboarding_required" };
  const params = new URL(request.url).searchParams;
  if (path === "conversations/unread") {
    if (params.size) return { status: "invalid_request" };
    const { data, error } = await supabase.rpc("get_direct_unread_counts").select("visible_unread::text,hidden_unread::text");
    if (error) throw error;
    const row = data?.[0];
    if (!row || !isMobileMessageId(row.visible_unread, true) || !isMobileMessageId(row.hidden_unread, true)) throw new Error("Invalid unread counts");
    return { status: "loaded", counts: { visible: row.visible_unread, hidden: row.hidden_unread } };
  }
  if (path !== "conversations") {
    const [, conversationId, action] = path.split("/");
    if (!isUuid(conversationId)) return { status: "invalid_request" };
    const post = request.method === "POST";
    const allowed = !post && action === "messages" ? ["before", "after", "through", "limit"] : [];
    if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) return { status: "invalid_request" };
    const before = params.get("before"); const after = params.get("after"); const through = params.get("through");
    const rawLimit = params.get("limit") ?? "50";
    if (!post && action === "messages" && ((before !== null && !isMobileMessageId(before))
      || (after !== null && !isMobileMessageId(after, true)) || (through !== null && !isMobileMessageId(through, true))
      || (before !== null && after !== null) || (through !== null && after === null)
      || (through !== null && after !== null && BigInt(after) > BigInt(through))
      || !/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 200)) return { status: "invalid_cursor" };
    const access = await readMobileConversation(supabase, conversationId);
    if (!access) return { status: "not_available" };
    if (post) {
      const exactFields = (keys: string[]) => Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
      if (action === "messages") {
        if (!exactFields(["clientMessageId", "body"]) || !isUuid(body.clientMessageId) || typeof body.body !== "string") return { status: "invalid_request" };
        const normalized = body.body.trim();
        if (!normalized || Array.from(normalized).length > 4000) return { status: "invalid_body" };
        // shortcut: 幂等沿用消息行唯一键，物理删除后旧 UUID 的重放边界由 Ticket 6 联合核验。
        const result = await sendSupabaseConversationMessage({ async rpc(_name, args) {
          const result = await supabase.rpc("send_conversation_message", args)
            .select("result_status,message_id::text,conversation_id,sender_id,sender_display_name,body,created_at");
          if (!result.error && (!Array.isArray(result.data) || result.data.length !== 1
            || !["sent", "onboarding_required", "invalid_request", "invalid_body", "not_available", "not_allowed", "idempotency_conflict"].includes(result.data[0].result_status))) {
            throw new Error("Invalid send response");
          }
          return result;
        } }, conversationId, body.clientMessageId, normalized);
        if (result.status === "sent") {
          if (!isMobileMessageId(result.message.id) || result.message.conversationId !== conversationId || result.message.senderId !== member.userId) throw new Error("Invalid message receipt");
          // 原 RPC 的幂等回执可能对应已清除的旧消息；返回正文前仍须经过当前 RLS。
          const { data: visible, error } = await supabase.from("messages").select("id::text")
            .eq("conversation_id", conversationId).filter("id", "eq", result.message.id).is("deleted_at", null).limit(1).maybeSingle();
          if (error) throw error;
          if (access.kind === "direct") {
            try { onDirectMessageSent?.(result.message.id, conversationId); } catch { /* 推送失败不能改变已发送结果。 */ }
          }
          if (!visible) return { status: "sent_not_visible", messageId: result.message.id, clientMessageId: body.clientMessageId, conversationId };
        }
        return result;
      }
      if (action === "reconcile") {
        if (!exactFields(["messageIds"]) || !Array.isArray(body.messageIds) || body.messageIds.length < 1 || body.messageIds.length > 200
          || !body.messageIds.every(id => isMobileMessageId(id)) || new Set(body.messageIds).size !== body.messageIds.length) return { status: "invalid_request" };
        const ids = body.messageIds as string[];
        const messages = await readMobileMessages(supabase, conversationId, { ids, limit: ids.length, ascending: true });
        const visible = new Set(messages.map(message => message.id));
        return { status: "reconciled", conversationId, messages, removedMessageIds: ids.filter(id => !visible.has(id)) };
      }
      if (access.kind !== "direct") return { status: "not_allowed" };
      if (!exactFields(["throughMessageId"]) || !isMobileMessageId(body.throughMessageId)) return { status: "invalid_cursor" };
      const invokeRpc = supabase.rpc.bind(supabase) as unknown as DirectMessageRpcClient["rpc"];
      const service = createDirectMessageService(createSupabaseDirectMessageBackend({ rpc: invokeRpc }));
      const result = action === "clear" ? await service.clearConversation(conversationId, body.throughMessageId)
        : await service.markRead(conversationId, body.throughMessageId);
      return ["updated", "not_available", "invalid_cursor", "temporarily_unavailable"].includes(result.status) ? result : { status: "temporarily_unavailable" };
    }
    if (!action) {
      const conversation = await readMobileConversationState(supabase, access, member.userId);
      return conversation ? { status: "loaded", conversation } : { status: "not_available" };
    }
    const limit = Number(rawLimit);
    const ascending = after !== null;
    const rows = await readMobileMessages(supabase, conversationId, {
      ...(before !== null ? { before } : {}), ...(after !== null ? { after } : {}), ...(through !== null ? { through } : {}),
      limit: limit + 1, ascending,
    });
    const selected = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? selected.at(-1)!.id : null;
    return { status: "loaded", messages: ascending ? selected : selected.reverse(),
      page: { direction: ascending ? "after" : "before", limit, nextCursor, through },
    };
  }
  if ([...params.keys()].some(key => !["kind", "scope", "limit", "offset"].includes(key) || params.getAll(key).length !== 1)) return { status: "invalid_request" };
  const kind = params.get("kind") ?? "direct";
  const scope = params.get("scope") ?? (kind === "course" ? "current" : "visible");
  const page = readMobilePagination(params);
  if (!page || !["direct", "course"].includes(kind) || !(kind === "course" ? ["current", "archived"] : ["visible", "hidden"]).includes(scope)) return { status: "invalid_request" };
  if (kind === "course") {
    const { data, error } = await supabase.rpc("get_dashboard_courses", { target_school: member.currentSchoolId })
      .eq("archived", scope === "archived").order("code").order("course_id").range(page.offset, page.offset + page.limit);
    if (error) throw error;
    const rows = data ?? [];
    return { status: "loaded", schoolId: member.currentSchoolId,
      conversations: rows.slice(0, page.limit).map(row => ({ conversationId: row.conversation_id, kind: "course", courseId: row.course_id, title: `${row.code} ${row.title}`, term: row.term, archived: row.archived })),
      page: { ...page, nextOffset: rows.length > page.limit ? page.offset + page.limit : null },
    };
  }
  const { data, error } = await supabase.rpc("list_friends", { include_hidden: scope === "hidden" })
    .eq("hidden", scope === "hidden").order("effective_name").order("member_id").range(page.offset, page.offset + page.limit);
  if (error) throw error;
  const rows = data ?? [];
  const visible = rows.slice(0, page.limit);
  const { data: unread, error: unreadError } = visible.length ? await supabase.rpc("list_direct_conversation_unread", { include_hidden: scope === "hidden" })
    .select("conversation_id,unread_count::text").in("conversation_id", visible.map(row => row.conversation_id)) : { data: [], error: null };
  if (unreadError) throw unreadError;
  const byConversation = new Map((unread ?? []).map(row => [row.conversation_id, row.unread_count]));
  return { status: "loaded", schoolId: member.currentSchoolId,
    conversations: visible.map(row => ({ conversationId: row.conversation_id, kind: "direct", memberId: row.member_id, title: row.effective_name, hidden: row.hidden, unreadCount: byConversation.get(row.conversation_id) ?? "0" })),
    page: { ...page, nextOffset: rows.length > page.limit ? page.offset + page.limit : null },
  };
}
