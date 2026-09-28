"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Avatar } from "@/components/ui/chat";

import {
  initialFriendActionState,
  type FriendActionState,
  type FriendMutationAction,
} from "../friend-action-state";
import type {
  FriendListItem,
  FriendRequestView,
  MemberBlockStatus,
  SharedCourseView,
} from "../friendship-service";
import {
  ReportForm,
  type ReportAction,
} from "@/features/reporting/components/report-form";

const BLOCK_STATUS_LABEL: Record<
  Exclude<MemberBlockStatus, "none">,
  string
> = {
  blocked_by_me: "你已拉黑对方",
  blocked_by_other: "对方已拉黑你",
  mutual: "双方互相拉黑",
};

export function blockStatusLabel(status: MemberBlockStatus) {
  return status === "none" ? null : BLOCK_STATUS_LABEL[status];
}

export function canUnblock(status: MemberBlockStatus) {
  return status === "blocked_by_me" || status === "mutual";
}

export function ActionFeedback({ state }: { state: FriendActionState }) {
  if (state.status === "idle") return null;
  const successful = [
    "sent",
    "accepted",
    "rejected",
    "saved",
    "cleared",
    "removed",
  ].includes(state.status);
  return (
    <p
      aria-live="polite"
      className={`mt-2 text-xs ${successful ? "text-success" : "text-amber-700"}`}
      role="status"
    >
      {state.message}
    </p>
  );
}

export function ActionForm({
  action,
  className = "",
  fields,
  label,
}: {
  action: FriendMutationAction;
  className?: string;
  fields: Record<string, string>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialFriendActionState,
  );
  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <button
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-panel disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "处理中…" : label}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

export function CourseChips({ courses }: { courses: SharedCourseView[] }) {
  if (courses.length === 0) {
    return <p className="text-xs text-muted">当前学期没有共同课程</p>;
  }
  return (
    <ul aria-label="当前共同课程" className="flex flex-wrap gap-2">
      {courses.map((course) => (
        <li
          className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-accent"
          key={course.id}
        >
          {course.code} · {course.title}
        </li>
      ))}
    </ul>
  );
}

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
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-lg font-bold text-ink">好友申请与历史</h2>
      <p className="mt-1 text-sm text-muted">
        申请不可撤回；处理后和过期记录仍会保留。
      </p>
      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-muted">暂时没有好友申请。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {requests.map((request) => (
            <li
              className="rounded-xl border border-line bg-card p-4"
              key={request.requestId}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">
                    {request.displayName}
                  </p>
                  <p className="text-xs text-muted">
                    {request.direction === "incoming"
                      ? "收到的申请"
                      : "发出的申请"}
                  </p>
                </div>
                <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-semibold text-ink">
                  {REQUEST_STATUS[request.status]}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink">
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
    <div className="mt-4 rounded-xl bg-panel p-3">
      <form action={formAction}>
        <input name="intent" type="hidden" value="note" />
        <input name="memberId" type="hidden" value={friend.memberId} />
        <label className="block text-xs font-medium text-ink">
          <span className="sr-only">
            给{friend.effectiveName}设置私有备注
          </span>
          私有备注
          <input
            aria-label={`给${friend.effectiveName}设置私有备注`}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            name="note"
            onChange={(event) => setNote(event.target.value)}
            placeholder={`当前显示：${friend.effectiveName}`}
            value={note}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className={
              tooLong ? "text-xs text-badge" : "text-xs text-muted"
            }
          >
            {length}/15
          </span>
          <button
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={pending || tooLong}
            type="submit"
          >
            保存备注
          </button>
        </div>
        {tooLong ? (
          <p className="mt-1 text-xs text-badge">备注最多 15 个字符。</p>
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
    <li className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar id={friend.memberId} name={friend.effectiveName} size={40} />
          <div className="min-w-0">
          <h3 className="font-semibold text-ink">{friend.effectiveName}</h3>
          {friend.effectiveName !== friend.displayName ? (
            <p className="text-xs text-muted">
              显示名称：{friend.displayName}
            </p>
          ) : null}
          {friend.sendStatus === "blocked" ? (
            <p className="mt-1 text-xs font-semibold text-badge">
              {blockStatusLabel(friend.blockStatus)}，双方不能发送消息。
            </p>
          ) : null}
          {unreadCount > 0 ? (
            <p className="mt-1 inline-block rounded-full bg-badge px-2 py-0.5 text-[11px] font-bold text-white">
              {unreadCount} 条未读
            </p>
          ) : null}
          </div>
        </div>
        <Link
          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
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
          <p className="mt-1 text-[11px] text-muted">
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
          <p className="mt-1 text-[11px] text-muted">
            拉黑后双方都不能发送消息。
          </p>
        </div>
        <div>
          <ActionForm
            action={action}
            fields={{ intent: "remove", memberId: friend.memberId }}
            label="删除好友"
          />
          <p className="mt-1 text-[11px] text-muted">
            只解除关系，不会替对方删除历史。
          </p>
        </div>
      </div>
    </li>
  );
}
