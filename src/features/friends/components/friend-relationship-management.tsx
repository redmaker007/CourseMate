"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { initialFriendActionState } from "../friend-action-state";
import type {
  FriendListItem,
  FriendRequestView,
} from "../friendship-service";
import {
  ActionFeedback,
  ActionForm,
  blockStatusLabel,
  canUnblock,
  CourseChips,
  type FriendMutationAction,
} from "./friend-discovery";
import {
  ReportForm,
  type ReportAction,
} from "@/features/reporting/components/report-form";

const REQUEST_STATUS: Record<FriendRequestView["status"], string> = {
  pending: "待处理",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
};

export function RequestHistory({
  action,
  reportAction,
  requests,
}: {
  action: FriendMutationAction;
  reportAction: ReportAction;
  requests: FriendRequestView[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">好友申请与历史</h2>
      <p className="mt-1 text-sm text-slate-600">
        申请不可撤回；处理后和过期记录仍会保留。
      </p>
      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">暂时没有好友申请。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {requests.map((request) => (
            <li
              className="rounded-2xl border border-slate-200 p-4"
              key={request.requestId}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-950">
                    {request.displayName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {request.direction === "incoming"
                      ? "收到的申请"
                      : "发出的申请"}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {REQUEST_STATUS[request.status]}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                {request.message}
              </p>
              {request.direction === "incoming" ? (
                <ReportForm
                  action={reportAction}
                  label="举报好友申请"
                  targetId={request.requestId}
                  targetType="friend_request"
                />
              ) : null}
              {request.direction === "incoming" &&
              request.status === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionForm
                    action={action}
                    fields={{ intent: "accept", requestId: request.requestId }}
                    label="接受"
                  />
                  <ActionForm
                    action={action}
                    fields={{ intent: "reject", requestId: request.requestId }}
                    label="拒绝"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FriendNoteForm({
  action,
  friend,
}: {
  action: FriendMutationAction;
  friend: FriendListItem;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialFriendActionState,
  );
  const [note, setNote] = useState("");
  const length = Array.from(note.trim()).length;
  const tooLong = length > 15;
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-3">
      <form action={formAction}>
        <input name="intent" type="hidden" value="note" />
        <input name="memberId" type="hidden" value={friend.memberId} />
        <label className="block text-xs font-medium text-slate-700">
          <span className="sr-only">
            给{friend.effectiveName}设置私有备注
          </span>
          私有备注
          <input
            aria-label={`给${friend.effectiveName}设置私有备注`}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            name="note"
            onChange={(event) => setNote(event.target.value)}
            placeholder={`当前显示：${friend.effectiveName}`}
            value={note}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className={
              tooLong ? "text-xs text-rose-700" : "text-xs text-slate-500"
            }
          >
            {length}/15
          </span>
          <button
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={pending || tooLong}
            type="submit"
          >
            保存备注
          </button>
        </div>
        {tooLong ? (
          <p className="mt-1 text-xs text-rose-700">备注最多 15 个字符。</p>
        ) : null}
        <ActionFeedback state={state} />
      </form>
      <ActionForm
        action={action}
        className="mt-2"
        fields={{ intent: "clear-note", memberId: friend.memberId }}
        label="清除备注"
      />
    </div>
  );
}

export function FriendCard({
  action,
  friend,
  reportAction,
  unreadCount = 0,
}: {
  action: FriendMutationAction;
  friend: FriendListItem;
  reportAction: ReportAction;
  unreadCount?: number;
}) {
  const unblockAllowed = canUnblock(friend.blockStatus);
  return (
    <li className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{friend.effectiveName}</h3>
          {friend.effectiveName !== friend.displayName ? (
            <p className="text-xs text-slate-500">
              显示名称：{friend.displayName}
            </p>
          ) : null}
          {friend.sendStatus === "blocked" ? (
            <p className="mt-1 text-xs font-semibold text-rose-700">
              {blockStatusLabel(friend.blockStatus)}，双方不能发送消息。
            </p>
          ) : null}
          {unreadCount > 0 ? (
            <p className="mt-1 text-xs font-bold text-indigo-700">
              {unreadCount} 条未读
            </p>
          ) : null}
        </div>
        <Link
          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
          href={`/messages/${friend.conversationId}`}
        >
          打开会话
        </Link>
      </div>
      <div className="mt-3">
        <CourseChips courses={friend.sharedCourses} />
      </div>
      <ReportForm
        action={reportAction}
        label="举报成员资料"
        targetId={friend.memberId}
        targetType="profile"
      />
      <FriendNoteForm action={action} friend={friend} />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <ActionForm
            action={action}
            fields={{
              intent: friend.hidden ? "unhide" : "hide",
              memberId: friend.memberId,
            }}
            label={friend.hidden ? "解除屏蔽" : "屏蔽"}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            屏蔽只影响你的列表，对方不会知道。
          </p>
        </div>
        <div>
          {friend.blockStatus === "blocked_by_other" ? null : (
            <ActionForm
              action={action}
              fields={{
                intent: unblockAllowed ? "unblock" : "block",
                memberId: friend.memberId,
              }}
              label={unblockAllowed ? "解除我设置的拉黑" : "拉黑"}
            />
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            拉黑后双方都不能发送消息。
          </p>
        </div>
        <div>
          <ActionForm
            action={action}
            fields={{ intent: "remove", memberId: friend.memberId }}
            label="删除好友"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            只解除关系，不会替对方删除历史。
          </p>
        </div>
      </div>
    </li>
  );
}
