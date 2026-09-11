"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  initialFriendActionState,
  initialFriendSearchState,
  type FriendMutationAction,
  type FriendSearchAction,
} from "../friend-action-state";
import type { FriendDiscovery } from "../friendship-service";
import {
  ActionFeedback,
  ActionForm,
  blockStatusLabel,
  canUnblock,
  CourseChips,
} from "./friend-relationship-management";
import {
  ReportForm,
  type ReportAction,
} from "@/features/reporting/components/report-form";

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
        <span
          className={
            length > 300 ? "text-xs text-rose-700" : "text-xs text-slate-500"
          }
        >
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
      {length > 300 ? (
        <p className="text-xs text-rose-700">申请附言最多 300 个字符。</p>
      ) : null}
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
  reportAction,
}: {
  action: FriendMutationAction;
  member: FriendDiscovery;
  reportAction: ReportAction;
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
      <ReportForm
        action={reportAction}
        label="举报成员资料"
        targetId={member.memberId}
        targetType="profile"
      />
      {member.relationship === "none" ? (
        <FriendRequestForm action={action} memberId={member.memberId} />
      ) : null}
      {member.relationship === "outgoing_request" ? (
        <p className="mt-3 text-sm text-amber-700">申请已经发出，等待对方处理。</p>
      ) : null}
      {member.relationship === "incoming_request" && member.incomingRequestId ? (
        <div className="mt-3">
          <p className="mb-2 text-sm text-indigo-700">
            对方已经申请你，可以直接处理收到的申请。
          </p>
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
          <p className="mb-2 text-sm text-rose-700">
            {blockStatusLabel(member.blockStatus)}，无法发送申请或消息。
          </p>
          {canUnblock(member.blockStatus) ? (
            <ActionForm
              action={action}
              fields={{ intent: "unblock", memberId: member.memberId }}
              label="解除我设置的拉黑"
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function FriendSearch({
  mutationAction,
  reportAction,
  searchAction,
}: {
  mutationAction: FriendMutationAction;
  reportAction: ReportAction;
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
        <label className="sr-only" htmlFor="friend-email">
          同校成员邮箱
        </label>
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
        <p
          aria-live="polite"
          className="mt-3 text-sm text-amber-700"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "found" ? (
        <DiscoveryResult
          action={mutationAction}
          member={state.member}
          reportAction={reportAction}
        />
      ) : null}
    </section>
  );
}
