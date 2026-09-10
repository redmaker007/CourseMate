import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import {
  friendMutationAction,
  searchFriendAction,
} from "@/features/friends/actions";
import { FriendWorkspace } from "@/features/friends/components/friend-workspace";
import { createProductionFriendshipService } from "@/features/friends/production-friendship-service";
import type {
  FriendListItem,
  FriendRequestView,
} from "@/features/friends/friendship-service";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  let unavailable = false;
  let friends: FriendListItem[] = [];
  let requests: FriendRequestView[] = [];
  try {
    const service = await createProductionFriendshipService();
    const [friendResult, requestResult] = await Promise.all([
      service.listFriends(false),
      service.listFriendRequests(),
    ]);
    unavailable =
      friendResult.status !== "loaded" || requestResult.status !== "loaded";
    friends = friendResult.status === "loaded" ? friendResult.friends : [];
    requests = requestResult.status === "loaded" ? requestResult.requests : [];
  } catch {
    unavailable = true;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
                CourseMate
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
                好友与申请
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                通过同校邮箱精确查找成员，管理申请、私有备注与联系限制。
              </p>
            </div>
            <Link className="text-sm font-semibold text-indigo-700" href="/dashboard">
              返回 Dashboard
            </Link>
          </div>
          {unavailable ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              部分好友数据暂时无法加载，请稍后刷新。
            </p>
          ) : null}
        </header>

        <FriendWorkspace
          friends={friends}
          mutationAction={friendMutationAction}
          requests={requests}
          searchAction={searchFriendAction}
        />
      </div>
    </main>
  );
}
