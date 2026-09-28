import "server-only";

import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";

import type { FriendListItem } from "./friendship-service";
import { createProductionFriendshipService } from "./production-friendship-service";

/** 「消息与好友」左栏里的一行会话。 */
export type InboxConversation = {
  conversationId: string;
  memberId: string;
  name: string;
  /**
   * 名字下面那行灰字。原型里是最后一条消息预览，但数据库还没有提供
   * 会话最后一条消息的接口，暂时显示共同课程。
   */
  subtitle: string;
  unread: number;
  blocked: boolean;
};

export type InboxFriend = {
  memberId: string;
  name: string;
  detail: string;
};

export type InboxData = {
  conversations: InboxConversation[];
  friends: InboxFriend[];
  pendingIncoming: number;
  unavailable: boolean;
};

function friendDetail(friend: FriendListItem) {
  const parts = [friend.major, friend.gradYear ? `${friend.gradYear} 届` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "未填写专业";
}

function courseSubtitle(friend: FriendListItem) {
  if (friend.sendStatus === "blocked") return "当前无法互相发送消息";
  if (friend.sharedCourses.length === 0) return "暂无共同课程";
  return friend.sharedCourses.map((course) => course.code).join(" · ");
}

/**
 * 左栏数据：好友（即私聊会话）、各会话未读、待处理的好友申请数。
 * 三路同时取；任何一路失败只让对应部分为空，并标记 unavailable 提示用户刷新。
 */
export async function loadInboxData(): Promise<InboxData> {
  try {
    const [friendService, messageService] = await Promise.all([
      createProductionFriendshipService(),
      createProductionDirectMessageService(),
    ]);
    const [friendResult, requestResult, unreadResult] = await Promise.all([
      friendService.listFriends(false),
      friendService.listFriendRequests(),
      messageService.listConversationUnread(false),
    ]);

    const friends = friendResult.status === "loaded" ? friendResult.friends : [];
    const unreadByConversation = new Map(
      unreadResult.status === "loaded"
        ? unreadResult.conversations.map((row) => [row.conversationId, row.unreadCount])
        : [],
    );
    const pendingIncoming =
      requestResult.status === "loaded"
        ? requestResult.requests.filter(
            (request) => request.direction === "incoming" && request.status === "pending",
          ).length
        : 0;

    // 有未读的排前面，其余按名字排，列表顺序稳定
    const conversations = friends
      .map((friend) => ({
        conversationId: friend.conversationId,
        memberId: friend.memberId,
        name: friend.effectiveName,
        subtitle: courseSubtitle(friend),
        unread: unreadByConversation.get(friend.conversationId) ?? 0,
        blocked: friend.sendStatus === "blocked",
      }))
      .sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name, "zh-CN"));

    return {
      conversations,
      friends: friends
        .map((friend) => ({
          memberId: friend.memberId,
          name: friend.effectiveName,
          detail: friendDetail(friend),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      pendingIncoming,
      unavailable:
        friendResult.status !== "loaded" ||
        requestResult.status !== "loaded" ||
        unreadResult.status !== "loaded",
    };
  } catch {
    return { conversations: [], friends: [], pendingIncoming: 0, unavailable: true };
  }
}
