import type {
  FindMemberResult,
  FriendBackend,
  FriendDiscovery,
  FriendListItem,
  FriendRequestView,
  FriendRelationshipState,
  SharedCourseView,
} from "./friendship-service";

type RpcResult = {
  data: unknown;
  error: unknown;
};

export interface FriendshipRpcClient {
  rpc(name: string, arguments_: Record<string, unknown>): Promise<RpcResult>;
}

function firstRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== "object") {
    return {};
  }
  return data[0] as Record<string, unknown>;
}

function mutationResult(row: Record<string, unknown>) {
  return {
    status: String(row.result_status ?? row.status ?? "not_available"),
    ...(row.request_id ? { requestId: String(row.request_id) } : {}),
    ...(row.conversation_id
      ? { conversationId: String(row.conversation_id) }
      : {}),
  };
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row) => typeof row === "object") as Record<string, unknown>[]
    : [];
}

export function createSupabaseFriendBackend(
  client: FriendshipRpcClient,
): FriendBackend {
  async function call(name: string, arguments_: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, arguments_);
    if (error) throw error;
    return data;
  }

  return {
    async findMemberByEmail(email): Promise<FindMemberResult> {
      const row = firstRow(
        await call("find_member_by_email", { candidate_email: email }),
      );
      const status = String(row.result_status ?? "not_found");
      if (status !== "found") {
        return {
          status: status as "not_found" | "rate_limited" | "onboarding_required",
        };
      }
      const member: FriendDiscovery = {
        memberId: String(row.member_id),
        displayName: String(row.display_name),
        avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
        major: row.major === null ? null : String(row.major),
        gradYear: row.grad_year === null ? null : Number(row.grad_year),
        sharedCourses: (Array.isArray(row.shared_courses)
          ? row.shared_courses
          : []) as SharedCourseView[],
        relationship: String(row.relationship_status) as FriendRelationshipState,
        incomingRequestId:
          row.incoming_request_id === null
            ? null
            : String(row.incoming_request_id),
      };
      return { status: "found", member };
    },

    async sendFriendRequest(targetMemberId, message) {
      return mutationResult(
        firstRow(
          await call("send_friend_request", {
            target_member_id: targetMemberId,
            request_message: message,
          }),
        ),
      );
    },

    async respondToFriendRequest(requestId, decision) {
      return mutationResult(
        firstRow(
          await call("respond_to_friend_request", {
            target_request_id: requestId,
            decision,
          }),
        ),
      );
    },

    async setFriendNote(targetMemberId, note) {
      const data = await call("set_friend_note", {
        target_member_id: targetMemberId,
        requested_note: note,
      });
      return { status: String(data ?? "not_available") };
    },

    async setFriendHidden(targetMemberId, hidden) {
      const data = await call("set_friend_hidden", {
        target_member_id: targetMemberId,
        requested_hidden: hidden,
      });
      return { status: String(data ?? "not_available") };
    },

    async setMemberBlocked(targetMemberId, blocked) {
      const data = await call("set_member_blocked", {
        target_member_id: targetMemberId,
        requested_blocked: blocked,
      });
      return { status: String(data ?? "not_available") };
    },

    async removeFriend(targetMemberId) {
      const data = await call("remove_friend", {
        target_member_id: targetMemberId,
      });
      return { status: String(data ?? "not_available") };
    },

    async listFriends(includeHidden) {
      const data = await call("list_friends", { include_hidden: includeHidden });
      return rows(data).map((row): FriendListItem => ({
        memberId: String(row.member_id),
        displayName: String(row.display_name),
        effectiveName: String(row.effective_name),
        avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
        major: row.major === null ? null : String(row.major),
        gradYear: row.grad_year === null ? null : Number(row.grad_year),
        sharedCourses: (Array.isArray(row.shared_courses)
          ? row.shared_courses
          : []) as SharedCourseView[],
        hidden: Boolean(row.hidden),
        sendStatus: String(row.send_status) as "allowed" | "blocked",
        conversationId: String(row.conversation_id),
      }));
    },

    async listFriendRequests() {
      const data = await call("list_friend_requests", {});
      return rows(data).map((row): FriendRequestView => ({
        requestId: String(row.request_id),
        direction: String(row.direction) as "incoming" | "outgoing",
        otherMemberId: String(row.other_member_id),
        displayName: String(row.display_name),
        avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
        message: String(row.message),
        status: String(row.status) as FriendRequestView["status"],
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
      }));
    },
  };
}
