"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendCourseMessageAction } from "../actions";
import { initialCourseMessageActionState } from "../course-action-state";
import type { SyncedCourseMessage } from "../message-sync";
import { useCourseMessageSync } from "../use-course-message-sync";

type CourseChatProps = {
  courseId: string;
  conversationId: string;
  currentUserId: string;
  archived: boolean;
  hasOlderMessages: boolean;
  initialMessages: SyncedCourseMessage[];
};

export function CourseChat({
  courseId,
  conversationId,
  currentUserId,
  archived,
  hasOlderMessages: initialHasOlderMessages,
  initialMessages,
}: CourseChatProps) {
  const {
    connected,
    hasOlderMessages,
    loadOlder,
    loadingOlder,
    mergeIncoming,
    messages,
  } = useCourseMessageSync({
    courseId,
    conversationId,
    initialMessages,
    initialHasOlderMessages,
  });
  const [actionState, formAction, pending] = useActionState(
    sendCourseMessageAction,
    initialCourseMessageActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!actionState.savedMessage) return;
    mergeIncoming([actionState.savedMessage]);
    formRef.current?.reset();
  }, [actionState.savedMessage, mergeIncoming]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">课程群聊</h2>
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            {archived
              ? "课程已归档，聊天记录仅供查看。"
              : connected
                ? "实时连接已建立"
                : "实时连接中断，页面可见时将自动轮询新消息。"}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {messages.length} 条
        </span>
      </div>

      {hasOlderMessages ? (
        <button
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
          type="button"
        >
          {loadingOlder ? "加载中……" : "加载更早消息"}
        </button>
      ) : null}

      <ol className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl bg-slate-50 p-4">
        {messages.length ? (
          messages.map((message) => {
            const own = message.senderId === currentUserId;
            return (
              <li className={own ? "ml-auto max-w-[85%]" : "max-w-[85%]"} key={message.id}>
                <p className="mb-1 text-xs text-slate-500">
                  {message.senderName} · {new Date(message.createdAt).toLocaleString("zh-CN")}
                </p>
                <p
                  className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm ${
                    own
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {message.body}
                </p>
              </li>
            );
          })
        ) : (
          <li className="py-10 text-center text-sm text-slate-500">还没有消息。</li>
        )}
      </ol>

      {!archived ? (
        <form action={formAction} className="mt-5 space-y-3" ref={formRef}>
          <input name="courseId" type="hidden" value={courseId} />
          <label className="sr-only" htmlFor="course-message-body">
            消息内容
          </label>
          <textarea
            className="min-h-24 w-full resize-y rounded-2xl border border-slate-300 px-4 py-3 text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            disabled={pending}
            id="course-message-body"
            maxLength={4000}
            name="body"
            placeholder="发送纯文字消息……"
            required
          />
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-rose-700" role="status">
              {actionState.status === "invalid" || actionState.status === "unavailable"
                ? actionState.message
                : ""}
            </p>
            <button
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
              disabled={pending}
              type="submit"
            >
              {pending ? "发送中……" : "发送"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
