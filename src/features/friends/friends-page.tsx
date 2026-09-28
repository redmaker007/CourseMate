import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import {
  friendMutationAction,
  searchFriendAction,
} from "@/features/friends/actions";
import {
  FilteredFriendList,
  FriendWorkspace,
} from "@/features/friends/components/friend-workspace";
import type {
  BlockedMemberListItem,
  FriendListItem,
  FriendRequestView,
} from "@/features/friends/friendship-service";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";
import { submitBehaviorReportAction } from "@/features/reporting/actions";

import { createProductionFriendshipService } from "./production-friendship-service";

export async function renderFriendsPage(filtered: boolean) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  let unavailable = false;
  let friends: FriendListItem[] = [];
  let requests: FriendRequestView[] = [];
  let blockedMembers: BlockedMemberListItem[] = [];
  let unreadByConversation: Record<string, number> = {};
  try {
    const service = await createProductionFriendshipService();
    const messageService = await createProductionDirectMessageService();
    const [friendResult, secondaryResult, unreadResult] = await Promise.all([
      service.listFriends(filtered),
      filtered ? service.listBlockedMembers() : service.listFriendRequests(),
      messageService.listConversationUnread(filtered),
    ]);
    unavailable =
      friendResult.status !== "loaded" ||
      secondaryResult.status !== "loaded" ||
      unreadResult.status !== "loaded";
    friends = friendResult.status === "loaded" ? friendResult.friends : [];
    if (secondaryResult.status === "loaded") {
      if ("members" in secondaryResult) blockedMembers = secondaryResult.members;
      if ("requests" in secondaryResult) requests = secondaryResult.requests;
    }
    unreadByConversation =
      unreadResult.status === "loaded"
        ? Object.fromEntries(
            unreadResult.conversations.map((conversation) => [
              conversation.conversationId,
              conversation.unreadCount,
            ]),
          )
        : {};
  } catch {
    unavailable = true;
  }

  return (
    <main className="min-h-full bg-canvas">
      <SchoolTestBanner member={member} />
      <header className="border-b border-line bg-card px-4 py-3 md:px-6">
        {filtered ? (
          <>
            <Link className="text-xs font-medium text-accent" href="/friends">
              ← 返回好友页
            </Link>
            <h1 className="mt-1 text-lg font-bold text-ink">屏蔽与拉黑</h1>
            <p className="mt-0.5 text-xs text-muted">
              屏蔽仅影响你的显示偏好；拉黑是双方都能感知的联系限制。
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-ink">消息与好友</h1>
            <p className="mt-0.5 text-xs text-muted">
              通过同校邮箱精确查找成员，管理申请、私有备注与联系限制。
            </p>
          </>
        )}
        {unavailable ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {filtered
              ? "过滤列表暂时无法加载，请稍后刷新。"
              : "部分好友数据暂时无法加载，请稍后刷新。"}
          </p>
        ) : null}
      </header>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 md:px-6">
        {filtered ? (
          <FilteredFriendList
            blockedMembers={blockedMembers}
            friends={friends}
            mutationAction={friendMutationAction}
            reportAction={submitBehaviorReportAction}
            unreadByConversation={unreadByConversation}
          />
        ) : (
          <FriendWorkspace
            friends={friends}
            mutationAction={friendMutationAction}
            reportAction={submitBehaviorReportAction}
            requests={requests}
            searchAction={searchFriendAction}
            unreadByConversation={unreadByConversation}
          />
        )}
      </div>
    </main>
  );
}
