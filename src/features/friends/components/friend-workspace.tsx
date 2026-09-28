"use client";

import Link from "next/link";

import type {
  BlockedMemberListItem,
  FriendListItem,
  FriendRequestView,
} from "../friendship-service";
import type {
  FriendMutationAction,
  FriendSearchAction,
} from "../friend-action-state";
import { FriendSearch } from "./friend-discovery";
import {
  ActionForm,
  FriendCard,
  RequestHistory,
} from "./friend-relationship-management";
import {
  ReportForm,
  type ReportAction,
} from "@/features/reporting/components/report-form";

function FriendList({
  action,
  friends,
  reportAction,
  unreadByConversation,
}: {
  action: FriendMutationAction;
  friends: FriendListItem[];
  reportAction: ReportAction;
  unreadByConversation: Record<string, number>;
}) {
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">好友与私聊</h2>
          <p className="mt-1 text-sm text-muted">
            备注只对你可见，共同课程按当前学期动态计算。
          </p>
        </div>
        <Link
          className="text-sm font-semibold text-accent"
          href="/friends/filtered"
        >
          查看屏蔽与拉黑
        </Link>
      </div>
      {friends.length === 0 ? (
        <p className="mt-4 text-sm text-muted">暂无普通列表中的好友。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {friends.map((friend) => (
            <FriendCard
              action={action}
              friend={friend}
              key={friend.memberId}
              reportAction={reportAction}
              unreadCount={unreadByConversation[friend.conversationId]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FriendWorkspace({
  friends,
  mutationAction,
  reportAction,
  requests,
  searchAction,
  unreadByConversation = {},
}: {
  friends: FriendListItem[];
  mutationAction: FriendMutationAction;
  reportAction: ReportAction;
  requests: FriendRequestView[];
  searchAction: FriendSearchAction;
  unreadByConversation?: Record<string, number>;
}) {
  return (
    // 好友列表（带私聊未读）是「消息」页的主体，放在前面；手机上也最先看到。
    <div className="grid gap-5 lg:grid-cols-2">
      <FriendList
        action={mutationAction}
        friends={friends}
        reportAction={reportAction}
        unreadByConversation={unreadByConversation}
      />
      <div className="space-y-5">
        <FriendSearch
          mutationAction={mutationAction}
          reportAction={reportAction}
          searchAction={searchAction}
        />
        <RequestHistory
          action={mutationAction}
          reportAction={reportAction}
          requests={requests}
        />
      </div>
    </div>
  );
}

export function FilteredFriendList({
  blockedMembers,
  friends,
  mutationAction,
  reportAction,
  unreadByConversation = {},
}: {
  blockedMembers: BlockedMemberListItem[];
  friends: FriendListItem[];
  mutationAction: FriendMutationAction;
  reportAction: ReportAction;
  unreadByConversation?: Record<string, number>;
}) {
  const hidden = friends.filter((friend) => friend.hidden);
  const blockedByOther = friends.filter(
    (friend) => friend.blockStatus === "blocked_by_other",
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="text-lg font-bold text-ink">已屏蔽</h2>
        <p className="mt-1 text-sm text-muted">
          只有你能看到这个状态；消息仍会投递。
        </p>
        <ul className="mt-4 space-y-3">
          {hidden.map((friend) => (
            <FriendCard
              action={mutationAction}
              friend={friend}
              key={friend.memberId}
              reportAction={reportAction}
              unreadCount={unreadByConversation[friend.conversationId]}
            />
          ))}
        </ul>
        {hidden.length === 0 ? (
          <p className="mt-4 text-sm text-muted">没有已屏蔽的好友。</p>
        ) : null}
      </section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="text-lg font-bold text-ink">我拉黑的成员</h2>
        <p className="mt-1 text-sm text-muted">
          拉黑会阻止双方发送；你可以在这里解除自己设置的限制。
        </p>
        <ul className="mt-4 space-y-3">
          {blockedMembers.map((member) => (
            <li
              className="rounded-xl border border-line bg-card p-4"
              key={member.memberId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink">
                    {member.displayName}
                  </h3>
                  <p className="mt-1 text-xs text-badge">
                    当前无法互相发送消息。
                  </p>
                </div>
                {member.conversationId ? (
                  <Link
                    className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
                    href={`/messages/${member.conversationId}`}
                  >
                    打开会话
                  </Link>
                ) : null}
              </div>
              <ReportForm
                action={reportAction}
                label="举报成员资料"
                targetId={member.memberId}
                targetType="profile"
              />
              <ActionForm
                action={mutationAction}
                className="mt-3"
                fields={{ intent: "unblock", memberId: member.memberId }}
                label="解除拉黑"
              />
            </li>
          ))}
        </ul>
        {blockedMembers.length === 0 ? (
          <p className="mt-4 text-sm text-muted">你没有拉黑任何成员。</p>
        ) : null}
        {blockedByOther.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-ink">
              其他方向的联系限制
            </h3>
            <ul className="mt-3 space-y-2">
              {blockedByOther.map((friend) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl bg-badge/10 p-3"
                  key={friend.memberId}
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {friend.effectiveName}
                    </p>
                    <p className="text-xs text-badge">
                      对方设置的限制仍然生效。
                    </p>
                  </div>
                  <Link
                    className="text-xs font-semibold text-accent"
                    href={`/messages/${friend.conversationId}`}
                  >
                    查看历史
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
