"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  initialFriendActionState,
  initialFriendSearchState,
  type FriendActionState,
  type FriendSearchState,
} from "../friend-action-state";
import type {
  BlockedMemberListItem,
  FriendDiscovery,
  FriendListItem,
  FriendRequestView,
  SharedCourseView,
} from "../friendship-service";

export type FriendMutationAction = (
  previousState: FriendActionState,
  formData: FormData,
) => Promise<FriendActionState>;

export type FriendSearchAction = (
  previousState: FriendSearchState,
  formData: FormData,
) => Promise<FriendSearchState>;

function ActionFeedback({ state }: { state: FriendActionState }) {
  if (state.status === "idle") return null;
  const successful = ["sent", "accepted", "rejected", "saved", "cleared", "removed"].includes(
    state.status,
  );
  return (
    <p
      aria-live="polite"
      className={`mt-2 text-xs ${successful ? "text-emerald-700" : "text-amber-700"}`}
      role="status"
    >
      {state.message}
    </p>
  );
}

function ActionForm({
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
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "处理中…" : label}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function CourseChips({ courses }: { courses: SharedCourseView[] }) {
  if (courses.length === 0) {
    return <p className="text-xs text-slate-500">当前学期没有共同课程</p>;
  }
  return (
    <ul aria-label="当前共同课程" className="flex flex-wrap gap-2">
      {courses.map((course) => (
        <li
          className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
          key={course.id}
        >
          {course.code} · {course.title}
        </li>
      ))}
    </ul>
  );
}

function FriendRequestForm({
  action,
  memberId,
}: {
  action: FriendMutationAction;
  memberId: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialFriendActionState,
  );
  const [message, setMessage] = useState("");
  const length = Array.from(message.trim()).length;
  const invalid = length < 1 || length > 300;
  return (
    <form action={formAction} className="mt-4 space-y-2">
      <input name="intent" type="hidden" value="request" />
      <input name="memberId" type="hidden" value={memberId} />
      <label className="block text-sm font-medium text-slate-800">
        申请附言
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          name="message"
          onChange={(event) => setMessage(event.target.value)}
          required
          value={message}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className={length > 300 ? "text-xs text-rose-700" : "text-xs text-slate-500"}>
          {length}/300
        </span>
        <button
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={pending || invalid}
          type="submit"
        >
          {pending ? "发送中…" : "发送申请"}
        </button>
      </div>
      {length > 300 ? <p className="text-xs text-rose-700">申请附言最多 300 个字符。</p> : null}
      <ActionFeedback state={state} />
    </form>
  );
}

export function CourseMemberRequestPanel({
  memberId,
  mutationAction,
}: {
  memberId: string;
  mutationAction: FriendMutationAction;
}) {
  return <FriendRequestForm action={mutationAction} memberId={memberId} />;
}

function DiscoveryResult({
  action,
  member,
}: {
  action: FriendMutationAction;
  member: FriendDiscovery;
}) {
  return (
    <article className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold text-slate-950">{member.displayName}</h3>
      {member.major || member.gradYear ? (
        <p className="mt-1 text-xs text-slate-600">
          {[member.major, member.gradYear ? `${member.gradYear} 届` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <div className="mt-3">
        <CourseChips courses={member.sharedCourses} />
      </div>
      {member.relationship === "none" ? (
        <FriendRequestForm action={action} memberId={member.memberId} />
      ) : null}
      {member.relationship === "outgoing_request" ? (
        <p className="mt-3 text-sm text-amber-700">申请已经发出，等待对方处理。</p>
      ) : null}
      {member.relationship === "incoming_request" && member.incomingRequestId ? (
        <div className="mt-3">
          <p className="mb-2 text-sm text-indigo-700">对方已经申请你，可以直接处理收到的申请。</p>
          <ActionForm
            action={action}
            fields={{ intent: "accept", requestId: member.incomingRequestId }}
            label="接受申请"
          />
        </div>
      ) : null}
      {member.relationship === "friend" ? (
        <p className="mt-3 text-sm text-emerald-700">你们已经是好友。</p>
      ) : null}
      {member.relationship === "blocked" ? (
        <div className="mt-3">
          <p className="mb-2 text-sm text-rose-700">当前存在拉黑限制，无法发送申请或消息。</p>
          <ActionForm
            action={action}
            fields={{ intent: "unblock", memberId: member.memberId }}
            label="解除我设置的拉黑"
          />
        </div>
      ) : null}
    </article>
  );
}

function FriendSearch({
  mutationAction,
  searchAction,
}: {
  mutationAction: FriendMutationAction;
  searchAction: FriendSearchAction;
}) {
  const [state, formAction, pending] = useActionState(
    searchAction,
    initialFriendSearchState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== "idle") formRef.current?.reset();
  }, [state]);
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">按完整邮箱查找</h2>
      <p className="mt-1 text-sm text-slate-600">
        只会精确匹配同校成员；邮箱不会出现在 URL、结果或浏览器存储中。
      </p>
      <form
        action={formAction}
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        ref={formRef}
      >
        <label className="sr-only" htmlFor="friend-email">同校成员邮箱</label>
        <input
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
          id="friend-email"
          name="email"
          placeholder="name@school.edu"
          required
          type="email"
        />
        <button
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "查找中…" : "查找成员"}
        </button>
      </form>
      {state.status !== "idle" && state.status !== "found" ? (
        <p aria-live="polite" className="mt-3 text-sm text-amber-700" role="status">
          {state.message}
        </p>
      ) : null}
      {state.status === "found" ? (
        <DiscoveryResult action={mutationAction} member={state.member} />
      ) : null}
    </section>
  );
}

const REQUEST_STATUS: Record<FriendRequestView["status"], string> = {
  pending: "待处理",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
};

function RequestHistory({
  action,
  requests,
}: {
  action: FriendMutationAction;
  requests: FriendRequestView[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">好友申请与历史</h2>
      <p className="mt-1 text-sm text-slate-600">申请不可撤回；处理后和过期记录仍会保留。</p>
      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">暂时没有好友申请。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {requests.map((request) => (
            <li className="rounded-2xl border border-slate-200 p-4" key={request.requestId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-950">{request.displayName}</p>
                  <p className="text-xs text-slate-500">
                    {request.direction === "incoming" ? "收到的申请" : "发出的申请"}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {REQUEST_STATUS[request.status]}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{request.message}</p>
              {request.direction === "incoming" && request.status === "pending" ? (
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
          <span className="sr-only">给{friend.effectiveName}设置私有备注</span>
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
          <span className={tooLong ? "text-xs text-rose-700" : "text-xs text-slate-500"}>
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
        {tooLong ? <p className="mt-1 text-xs text-rose-700">备注最多 15 个字符。</p> : null}
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

function FriendCard({
  action,
  friend,
  unreadCount = 0,
}: {
  action: FriendMutationAction;
  friend: FriendListItem;
  unreadCount?: number;
}) {
  return (
    <li className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{friend.effectiveName}</h3>
          {friend.effectiveName !== friend.displayName ? (
            <p className="text-xs text-slate-500">显示名称：{friend.displayName}</p>
          ) : null}
          {friend.sendStatus === "blocked" ? (
            <p className="mt-1 text-xs font-semibold text-rose-700">当前存在拉黑限制，双方不能发送消息。</p>
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
      <div className="mt-3"><CourseChips courses={friend.sharedCourses} /></div>
      <FriendNoteForm action={action} friend={friend} />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <ActionForm
            action={action}
            fields={{ intent: friend.hidden ? "unhide" : "hide", memberId: friend.memberId }}
            label={friend.hidden ? "解除屏蔽" : "屏蔽"}
          />
          <p className="mt-1 text-[11px] text-slate-500">屏蔽只影响你的列表，对方不会知道。</p>
        </div>
        <div>
          <ActionForm
            action={action}
            fields={{ intent: friend.sendStatus === "blocked" ? "unblock" : "block", memberId: friend.memberId }}
            label={friend.sendStatus === "blocked" ? "解除我设置的拉黑" : "拉黑"}
          />
          <p className="mt-1 text-[11px] text-slate-500">拉黑后双方都不能发送消息。</p>
        </div>
        <div>
          <ActionForm
            action={action}
            fields={{ intent: "remove", memberId: friend.memberId }}
            label="删除好友"
          />
          <p className="mt-1 text-[11px] text-slate-500">只解除关系，不会替对方删除历史。</p>
        </div>
      </div>
    </li>
  );
}

function FriendList({
  action,
  friends,
  unreadByConversation,
}: {
  action: FriendMutationAction;
  friends: FriendListItem[];
  unreadByConversation: Record<string, number>;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">好友列表</h2>
          <p className="mt-1 text-sm text-slate-600">备注只对你可见，共同课程按当前学期动态计算。</p>
        </div>
        <Link className="text-sm font-semibold text-indigo-700" href="/friends/filtered">
          查看屏蔽与拉黑
        </Link>
      </div>
      {friends.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">暂无普通列表中的好友。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {friends.map((friend) => (
            <FriendCard
              action={action}
              friend={friend}
              key={friend.memberId}
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
  requests,
  searchAction,
  unreadByConversation = {},
}: {
  friends: FriendListItem[];
  mutationAction: FriendMutationAction;
  requests: FriendRequestView[];
  searchAction: FriendSearchAction;
  unreadByConversation?: Record<string, number>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <FriendSearch mutationAction={mutationAction} searchAction={searchAction} />
        <RequestHistory action={mutationAction} requests={requests} />
      </div>
      <FriendList
        action={mutationAction}
        friends={friends}
        unreadByConversation={unreadByConversation}
      />
    </div>
  );
}

export function FilteredFriendList({
  blockedMembers,
  friends,
  mutationAction,
  unreadByConversation = {},
}: {
  blockedMembers: BlockedMemberListItem[];
  friends: FriendListItem[];
  mutationAction: FriendMutationAction;
  unreadByConversation?: Record<string, number>;
}) {
  const hidden = friends.filter((friend) => friend.hidden);
  const blockedByMe = new Set(blockedMembers.map((member) => member.memberId));
  const blockedByOther = friends.filter(
    (friend) =>
      friend.sendStatus === "blocked" && !blockedByMe.has(friend.memberId),
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">已屏蔽</h2>
        <p className="mt-1 text-sm text-slate-600">只有你能看到这个状态；消息仍会投递。</p>
        <ul className="mt-4 space-y-3">
          {hidden.map((friend) => (
            <FriendCard
              action={mutationAction}
              friend={friend}
              key={friend.memberId}
              unreadCount={unreadByConversation[friend.conversationId]}
            />
          ))}
        </ul>
        {hidden.length === 0 ? <p className="mt-4 text-sm text-slate-500">没有已屏蔽的好友。</p> : null}
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">我拉黑的成员</h2>
        <p className="mt-1 text-sm text-slate-600">拉黑会阻止双方发送；你可以在这里解除自己设置的限制。</p>
        <ul className="mt-4 space-y-3">
          {blockedMembers.map((member) => (
            <li className="rounded-2xl border border-slate-200 p-4" key={member.memberId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{member.displayName}</h3>
                  <p className="mt-1 text-xs text-rose-700">当前无法互相发送消息。</p>
                </div>
                {member.conversationId ? (
                  <Link
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
                    href={`/messages/${member.conversationId}`}
                  >
                    打开会话
                  </Link>
                ) : null}
              </div>
              <ActionForm
                action={mutationAction}
                className="mt-3"
                fields={{ intent: "unblock", memberId: member.memberId }}
                label="解除拉黑"
              />
            </li>
          ))}
        </ul>
        {blockedMembers.length === 0 ? <p className="mt-4 text-sm text-slate-500">你没有拉黑任何成员。</p> : null}
        {blockedByOther.length > 0 ? (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-bold text-slate-900">其他方向的联系限制</h3>
            <ul className="mt-3 space-y-2">
              {blockedByOther.map((friend) => (
                <li className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 p-3" key={friend.memberId}>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{friend.effectiveName}</p>
                    <p className="text-xs text-rose-700">对方设置的限制仍然生效。</p>
                  </div>
                  <Link className="text-xs font-semibold text-indigo-700" href={`/messages/${friend.conversationId}`}>
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
