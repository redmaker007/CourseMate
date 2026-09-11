import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import { friendMutationAction } from "@/features/friends/actions";
import { FilteredFriendList } from "@/features/friends/components/friend-workspace";
import { createProductionFriendshipService } from "@/features/friends/production-friendship-service";
import type {
  BlockedMemberListItem,
  FriendListItem,
} from "@/features/friends/friendship-service";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";
import { submitBehaviorReportAction } from "@/features/reporting/actions";

export const dynamic = "force-dynamic";

export default async function FilteredFriendsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  let unavailable = false;
  let friends: FriendListItem[] = [];
  let blockedMembers: BlockedMemberListItem[] = [];
  let unreadByConversation: Record<string, number> = {};
  try {
    const service = await createProductionFriendshipService();
    const messageService = await createProductionDirectMessageService();
    const [friendResult, blockResult, unreadResult] = await Promise.all([
      service.listFriends(true),
      service.listBlockedMembers(),
      messageService.listConversationUnread(true),
    ]);
    unavailable =
      friendResult.status !== "loaded" ||
      blockResult.status !== "loaded" ||
      unreadResult.status !== "loaded";
    friends = friendResult.status === "loaded" ? friendResult.friends : [];
    blockedMembers = blockResult.status === "loaded" ? blockResult.members : [];
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
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <Link className="text-sm font-semibold text-indigo-700" href="/friends">
            返回好友页
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            屏蔽与拉黑
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            屏蔽是仅影响你的显示偏好；拉黑是双方都能感知的联系限制。
          </p>
          {unavailable ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              过滤列表暂时无法加载，请稍后刷新。
            </p>
          ) : null}
        </header>

        <FilteredFriendList
          blockedMembers={blockedMembers}
          friends={friends}
          mutationAction={friendMutationAction}
          reportAction={submitBehaviorReportAction}
          unreadByConversation={unreadByConversation}
        />
      </div>
    </main>
  );
}
