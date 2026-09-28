import "server-only";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { getCurrentMember } from "@/features/auth/session";
import {
  friendMutationAction,
  searchFriendAction,
} from "@/features/friends/actions";
import { FriendSearch } from "@/features/friends/components/friend-discovery";
import {
  FriendCard,
  RequestHistory,
} from "@/features/friends/components/friend-relationship-management";
import { FilteredFriendList } from "@/features/friends/components/friend-workspace";
import { InboxPaneHeader } from "@/features/friends/components/inbox-shell";
import type {
  BlockedMemberListItem,
  FriendListItem,
  FriendRequestView,
} from "@/features/friends/friendship-service";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";
import { submitBehaviorReportAction } from "@/features/reporting/actions";

import { createProductionFriendshipService } from "./production-friendship-service";

/**
 * 「消息与好友」右栏的各个页面。左栏列表由 (inbox)/layout.tsx 渲染；
 * 这里每个页面都自己重新检查成员会话（不能只信 layout）。
 */

async function requireMember() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");
  return member;
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>
  );
}

const PANE_BODY = "mx-auto w-full max-w-2xl space-y-4 px-4 py-5 md:px-6";

/** /friends：桌面端右栏的空状态（手机端这时只显示左栏列表）。 */
export async function renderFriendsHome() {
  const member = await requireMember();
  return (
    <div className="flex flex-1 flex-col bg-chat">
      <SchoolTestBanner member={member} />
      <div className="m-auto flex flex-col items-center gap-2 px-6 text-center text-sm text-muted">
        <MessageCircle className="text-line" size={40} strokeWidth={1.5} />
        选择一个会话开始聊天
      </div>
    </div>
  );
}

/** /friends/requests：新的朋友（收到和发出的申请）。 */
export async function renderFriendRequestsPage() {
  const member = await requireMember();
  let requests: FriendRequestView[] = [];
  let unavailable = false;
  try {
    const result = await (await createProductionFriendshipService()).listFriendRequests();
    if (result.status === "loaded") requests = result.requests;
    else unavailable = true;
  } catch {
    unavailable = true;
  }

  return (
    <>
      <SchoolTestBanner member={member} />
      <InboxPaneHeader title="新的朋友" />
      <div className={PANE_BODY}>
        {unavailable ? <Unavailable>好友申请暂时无法加载，请稍后刷新。</Unavailable> : null}
        <RequestHistory
          action={friendMutationAction}
          reportAction={submitBehaviorReportAction}
          requests={requests}
        />
      </div>
    </>
  );
}

/** /friends/search：按完整邮箱添加好友（左栏的 + 按钮）。 */
export async function renderFriendSearchPage() {
  const member = await requireMember();
  return (
    <>
      <SchoolTestBanner member={member} />
      <InboxPaneHeader title="添加好友" />
      <div className={PANE_BODY}>
        <FriendSearch
          mutationAction={friendMutationAction}
          reportAction={submitBehaviorReportAction}
          searchAction={searchFriendAction}
        />
        <p className="text-xs text-muted">
          也可以在课程群的成员栏里直接向同班同学发送申请。
        </p>
      </div>
    </>
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /friends/[memberId]：好友详情，放备注、屏蔽、拉黑、删除、举报等管理操作。 */
export async function renderFriendDetailPage(memberId: string) {
  const member = await requireMember();
  if (!UUID_PATTERN.test(memberId)) notFound();

  let friend: FriendListItem | undefined;
  let unread = 0;
  try {
    const [friendService, messageService] = await Promise.all([
      createProductionFriendshipService(),
      createProductionDirectMessageService(),
    ]);
    // 包含已屏蔽的好友：从「屏蔽与拉黑」点进来时也要能打开
    const [friendResult, unreadResult] = await Promise.all([
      friendService.listFriends(true),
      messageService.listConversationUnread(true),
    ]);
    if (friendResult.status === "loaded") {
      friend = friendResult.friends.find((candidate) => candidate.memberId === memberId);
    }
    if (friend && unreadResult.status === "loaded") {
      const conversationId = friend.conversationId;
      unread =
        unreadResult.conversations.find((row) => row.conversationId === conversationId)
          ?.unreadCount ?? 0;
    }
  } catch {
    friend = undefined;
  }
  // 不是好友（或读取失败）一律 404，不透露对方是否存在
  if (!friend) notFound();

  return (
    <>
      <SchoolTestBanner member={member} />
      <InboxPaneHeader
        actions={
          <Link
            className="flex h-8 items-center gap-1 rounded-md bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
            href={`/messages/${friend.conversationId}`}
          >
            <MessageCircle size={14} strokeWidth={1.75} />
            发消息
          </Link>
        }
        title={friend.effectiveName}
      />
      <div className={PANE_BODY}>
        <ul>
          <FriendCard
            action={friendMutationAction}
            friend={friend}
            reportAction={submitBehaviorReportAction}
            unreadCount={unread}
          />
        </ul>
      </div>
    </>
  );
}

/** /friends/filtered：已屏蔽的好友与拉黑名单。 */
export async function renderFilteredFriendsPage() {
  const member = await requireMember();

  let unavailable = false;
  let friends: FriendListItem[] = [];
  let blockedMembers: BlockedMemberListItem[] = [];
  let unreadByConversation: Record<string, number> = {};
  try {
    const service = await createProductionFriendshipService();
    const messageService = await createProductionDirectMessageService();
    const [friendResult, blockedResult, unreadResult] = await Promise.all([
      service.listFriends(true),
      service.listBlockedMembers(),
      messageService.listConversationUnread(true),
    ]);
    unavailable =
      friendResult.status !== "loaded" ||
      blockedResult.status !== "loaded" ||
      unreadResult.status !== "loaded";
    friends = friendResult.status === "loaded" ? friendResult.friends : [];
    blockedMembers = blockedResult.status === "loaded" ? blockedResult.members : [];
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
    <>
      <SchoolTestBanner member={member} />
      <InboxPaneHeader
        subtitle="屏蔽仅影响你的显示偏好；拉黑是双方都能感知的联系限制。"
        title="屏蔽与拉黑"
      />
      <div className="space-y-4 px-4 py-5 md:px-6">
        {unavailable ? <Unavailable>过滤列表暂时无法加载，请稍后刷新。</Unavailable> : null}
        <FilteredFriendList
          blockedMembers={blockedMembers}
          friends={friends}
          mutationAction={friendMutationAction}
          reportAction={submitBehaviorReportAction}
          unreadByConversation={unreadByConversation}
        />
      </div>
    </>
  );
}
