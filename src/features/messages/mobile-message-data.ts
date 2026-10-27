import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
export type MobileConversationAccess = { id: string; kind: string; archived_at: string | null };

export function isMobileMessageId(value: unknown, allowZero = false): value is string {
  return typeof value === "string" && (allowZero ? /^(0|[1-9]\d{0,18})$/ : /^[1-9]\d{0,18}$/).test(value)
    && BigInt(value) <= BigInt("9223372036854775807");
}

export async function readMobileConversation(supabase: Client, id: string) {
  const { data, error } = await supabase.from("conversations").select("id,kind,archived_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data && !["direct", "course"].includes(data.kind)) throw new Error("Invalid conversation kind");
  return data;
}

export async function readMobileConversationState(supabase: Client, access: MobileConversationAccess, userId: string) {
  const [membership, latest] = await Promise.all([
    supabase.from("conversation_members").select("last_read_message_id::text,cleared_through_message_id::text")
      .eq("conversation_id", access.id).eq("user_id", userId).maybeSingle(),
    supabase.from("messages").select("id::text").eq("conversation_id", access.id).is("deleted_at", null).order("id", { ascending: false }).limit(1),
  ]);
  if (membership.error) throw membership.error;
  if (latest.error) throw latest.error;
  if (!membership.data) return null;
  const common = { conversationId: access.id, kind: access.kind, archived: access.archived_at !== null,
    lastReadMessageId: membership.data.last_read_message_id,
    clearedThroughMessageId: membership.data.cleared_through_message_id,
    latestMessageId: latest.data?.[0]?.id ?? "0",
  };
  if (access.kind === "direct") {
    const { data, error } = await supabase.rpc("get_direct_conversation_view", { target_conversation_id: access.id });
    if (error) throw error;
    const view = data?.[0];
    if (!view) return null;
    if (!["allowed", "blocked", "readonly"].includes(view.send_status)) throw new Error("Invalid send status");
    return { ...common, otherMemberId: view.other_member_id, otherDisplayName: view.other_display_name, hidden: view.hidden, sendStatus: view.send_status };
  }
  const { data, error } = await supabase.from("course_conversations").select("course_id").eq("conversation_id", access.id).maybeSingle();
  if (error) throw error;
  return data ? { ...common, courseId: data.course_id, hidden: false, sendStatus: access.archived_at ? "readonly" : "allowed" } : null;
}

export async function readMobileMessages(supabase: Client, conversationId: string, options: {
  before?: string; after?: string; through?: string; ids?: string[]; limit: number; ascending: boolean;
}) {
  if (options.ids?.length === 0) return [];
  // bigint 在数据库中转成 text，不能先经过 JS number 再 String()，否则会丢精度。
  let query = supabase.from("messages").select("id::text,client_message_id,conversation_id,sender_id,body,created_at")
    .eq("conversation_id", conversationId).is("deleted_at", null);
  if (options.before !== undefined) query = query.lt("id", options.before);
  if (options.after !== undefined) query = query.gt("id", options.after);
  if (options.through !== undefined) query = query.lte("id", options.through);
  if (options.ids) {
    if (!options.ids.every(id => isMobileMessageId(id))) throw new Error("Invalid reconciliation IDs");
    query = query.filter("id", "in", `(${options.ids.join(",")})`);
  }
  const { data, error } = await query.order("id", { ascending: options.ascending }).limit(options.limit);
  if (error) throw error;
  const rows = data ?? [];
  const senderIds = [...new Set(rows.flatMap(row => row.sender_id ? [row.sender_id] : []))];
  const { data: profiles, error: profileError } = senderIds.length
    ? await supabase.from("profiles").select("id,display_name").in("id", senderIds) : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles ?? []).map(row => [row.id, row.display_name]));
  return rows.map(row => ({ id: row.id, clientMessageId: row.client_message_id, conversationId: row.conversation_id,
    senderId: row.sender_id, senderDisplayName: row.sender_id ? names.get(row.sender_id) ?? "成员" : "已注销用户",
    body: row.body, createdAt: row.created_at,
  }));
}
