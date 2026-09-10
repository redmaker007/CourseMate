export type SharedCourseView = {
  id: string;
  code: string;
  title: string;
};

export type FriendRelationshipState =
  | "none"
  | "outgoing_request"
  | "incoming_request"
  | "friend"
  | "blocked";

export type FriendDiscovery = {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  major: string | null;
  gradYear: number | null;
  sharedCourses: SharedCourseView[];
  relationship: FriendRelationshipState;
  incomingRequestId: string | null;
};

export type FindMemberResult =
  | { status: "found"; member: FriendDiscovery }
  | { status: "not_found" | "rate_limited" | "onboarding_required" };

export type FriendListItem = {
  memberId: string;
  displayName: string;
  effectiveName: string;
  avatarUrl: string | null;
  major: string | null;
  gradYear: number | null;
  sharedCourses: SharedCourseView[];
  hidden: boolean;
  sendStatus: "allowed" | "blocked";
  conversationId: string;
};

export type FriendRequestView = {
  requestId: string;
  direction: "incoming" | "outgoing";
  otherMemberId: string;
  displayName: string;
  avatarUrl: string | null;
  message: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
};

export type BlockedMemberListItem = {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  activeFriendship: boolean;
  conversationId: string | null;
};

export interface FriendBackend {
  findMemberByEmail(email: string): Promise<FindMemberResult>;
  sendFriendRequest(targetMemberId: string, message: string): Promise<unknown>;
  respondToFriendRequest(
    requestId: string,
    decision: "accept" | "reject",
  ): Promise<unknown>;
  setFriendNote(targetMemberId: string, note: string | null): Promise<unknown>;
  setFriendHidden(targetMemberId: string, hidden: boolean): Promise<unknown>;
  setMemberBlocked(targetMemberId: string, blocked: boolean): Promise<unknown>;
  removeFriend(targetMemberId: string): Promise<unknown>;
  listFriends(includeHidden: boolean): Promise<FriendListItem[]>;
  listFriendRequests(): Promise<FriendRequestView[]>;
  listBlockedMembers(): Promise<BlockedMemberListItem[]>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function createFriendshipService(backend: FriendBackend) {
  return {
    async findMemberByEmail(rawEmail: string) {
      const email = rawEmail.trim().toLocaleLowerCase();
      if (
        email.length > 320 ||
        !/^[^\s@]+@[^\s@]+$/.test(email)
      ) {
        return { status: "invalid" } as const;
      }
      try {
        return await backend.findMemberByEmail(email);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async sendFriendRequest(targetMemberId: string, rawMessage: string) {
      if (!isUuid(targetMemberId)) {
        return { status: "invalid_target" } as const;
      }
      const message = rawMessage.trim();
      if ([...message].length < 1 || [...message].length > 300) {
        return {
          status: "invalid",
          fieldErrors: { message: "好友申请附言必须为 1–300 个字符。" },
        } as const;
      }
      try {
        return await backend.sendFriendRequest(targetMemberId, message);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async respondToFriendRequest(
      requestId: string,
      decision: "accept" | "reject",
    ) {
      if (!isUuid(requestId)) {
        return { status: "invalid_request" } as const;
      }
      try {
        return await backend.respondToFriendRequest(requestId, decision);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async setFriendNote(targetMemberId: string, rawNote: string) {
      if (!isUuid(targetMemberId)) {
        return { status: "invalid_target" } as const;
      }
      const normalizedNote = rawNote.trim();
      if ([...normalizedNote].length > 15) {
        return {
          status: "invalid",
          fieldErrors: { note: "好友备注最多为 15 个字符。" },
        } as const;
      }
      try {
        return await backend.setFriendNote(
          targetMemberId,
          normalizedNote || null,
        );
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async setFriendHidden(targetMemberId: string, hidden: boolean) {
      if (!isUuid(targetMemberId)) {
        return { status: "invalid_target" } as const;
      }
      try {
        return await backend.setFriendHidden(targetMemberId, hidden);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async setMemberBlocked(targetMemberId: string, blocked: boolean) {
      if (!isUuid(targetMemberId)) {
        return { status: "invalid_target" } as const;
      }
      try {
        return await backend.setMemberBlocked(targetMemberId, blocked);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async removeFriend(targetMemberId: string) {
      if (!isUuid(targetMemberId)) {
        return { status: "invalid_target" } as const;
      }
      try {
        return await backend.removeFriend(targetMemberId);
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async listFriends(includeHidden = false) {
      try {
        return {
          status: "loaded",
          friends: await backend.listFriends(includeHidden),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async listFriendRequests() {
      try {
        return {
          status: "loaded",
          requests: await backend.listFriendRequests(),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async listBlockedMembers() {
      try {
        return {
          status: "loaded",
          members: await backend.listBlockedMembers(),
        } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },
  };
}
