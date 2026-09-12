"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { DirectMessage } from "../direct-message-service";
import {
  initialDirectMessageActionState,
  type DirectMessageActionState,
} from "../message-action-state";
import { useDirectMessageSync } from "../use-direct-message-sync";
import { useMessageSend } from "../use-message-send";
import { SafeMessageText } from "./safe-message-text";
import {
  ReportForm,
  type ReportAction,
} from "@/features/reporting/components/report-form";

type MutationAction = (
  previousState: DirectMessageActionState,
  formData: FormData,
) => Promise<DirectMessageActionState>;

export function ChatWorkspace({
  clearAction,
  conversationId,
  currentUserId,
  initialHasOlderMessages,
  initialMessages,
  markReadAction,
  otherDisplayName,
  reportAction,
  sendAction,
  sendStatus,
}: {
  clearAction: MutationAction;
  conversationId: string;
  currentUserId: string;
  initialHasOlderMessages: boolean;
  initialMessages: DirectMessage[];
  markReadAction: (
    conversationId: string,
    throughMessageId: string,
  ) => Promise<string>;
  otherDisplayName: string;
  reportAction: ReportAction;
  sendAction: MutationAction;
  sendStatus: "allowed" | "blocked" | "readonly";
}) {
  const sync = useDirectMessageSync({
    conversationId,
    initialMessages,
    initialHasOlderMessages,
  });
  const { clearThrough, mergeIncoming } = sync;
  const [body, setBody] = useState("");
  const onSaved = useCallback(
    (message: DirectMessage) => mergeIncoming([message]),
    [mergeIncoming],
  );
  const onStart = useCallback(() => setBody(""), []);
  const submitClear: MutationAction = async (previousState, formData) => {
    const result = await clearAction(previousState, formData);
    if (result.status === "updated" && result.throughMessageId) {
      clearThrough(result.throughMessageId);
    }
    return result;
  };
  const {
    attempt,
    formAction: sendFormAction,
    pending: sending,
    retry,
    state: sendState,
  } = useMessageSend({
    action: sendAction,
    fixedFields: { conversationId },
    initialState: initialDirectMessageActionState,
    onSaved,
    onStart,
  });
  const [clearState, clearFormAction, clearing] = useActionState(
    submitClear,
    initialDirectMessageActionState,
  );
  const lastMarkedRef = useRef<string | null>(null);
  const markingRef = useRef<string | null>(null);
  const latestMessageId = sync.messages.at(-1)?.id;
  const bodyLength = Array.from(body.trim()).length;
  const bodyInvalid = bodyLength < 1 || bodyLength > 4000;
  const visibleAttempt = attempt && !sync.messages.some(
    (message) => message.clientMessageId === attempt.clientMessageId,
  ) ? attempt : null;

  useEffect(() => {
    const markWhenVisible = () => {
      if (
        document.visibilityState !== "visible" ||
        !latestMessageId ||
        lastMarkedRef.current === latestMessageId ||
        markingRef.current === latestMessageId
      ) return;
      markingRef.current = latestMessageId;
      startTransition(() => {
        void markReadAction(conversationId, latestMessageId)
          .then((status) => {
            if (
              status === "updated" &&
              (lastMarkedRef.current === null ||
                BigInt(latestMessageId) > BigInt(lastMarkedRef.current))
            ) {
              lastMarkedRef.current = latestMessageId;
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (markingRef.current === latestMessageId) {
              markingRef.current = null;
            }
          });
      });
    };
    markWhenVisible();
    window.addEventListener("focus", markWhenVisible);
    document.addEventListener("visibilitychange", markWhenVisible);
    return () => {
      window.removeEventListener("focus", markWhenVisible);
      document.removeEventListener("visibilitychange", markWhenVisible);
    };
  }, [conversationId, latestMessageId, markReadAction]);

  const restriction =
    sendStatus === "blocked"
      ? "当前存在拉黑限制，历史仍可查看，但双方不能发送新消息。"
      : sendStatus === "readonly"
        ? "你们已不是好友，历史仍可查看，但不能发送新消息。"
        : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <Link className="text-xs font-semibold text-indigo-700" href="/friends">
              返回好友
            </Link>
            <h1 className="mt-1 text-xl font-bold text-slate-950">
              {otherDisplayName}
            </h1>
          </div>
          <span className="text-xs text-slate-500">
            {sync.connected ? "实时连接" : "正在同步"}
          </span>
        </header>

        {restriction ? (
          <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {restriction}
          </p>
        ) : null}

        <section
          aria-label="消息记录"
          className="flex-1 space-y-3 overflow-y-auto px-5 py-5"
        >
          {sync.hasOlderMessages ? (
            <button
              className="mx-auto block rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              disabled={sync.loadingOlder}
              onClick={() => void sync.loadOlder()}
              type="button"
            >
              {sync.loadingOlder ? "加载中…" : "加载更早消息"}
            </button>
          ) : null}
          {sync.messages.length === 0 && !visibleAttempt ? (
            <p className="py-12 text-center text-sm text-slate-500">
              清除位置之后还没有消息。
            </p>
          ) : (
            <ol className="space-y-3">
              {sync.messages.map((message) => {
                const own = message.senderId === currentUserId;
                return (
                  <li
                    className={`flex ${own ? "justify-end" : "justify-start"}`}
                    key={message.id}
                  >
                    <article
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                        own
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      <p className={`mb-1 text-xs ${own ? "text-indigo-100" : "text-slate-500"}`}>
                        {own ? "我" : message.senderDisplayName}
                      </p>
                      <SafeMessageText text={message.body} />
                      <time className={`mt-1 block text-[11px] ${own ? "text-indigo-100" : "text-slate-500"}`}>
                        {message.createdAt}
                      </time>
                      {!own && message.senderId ? (
                        <ReportForm
                          action={reportAction}
                          label="举报消息"
                          targetId={message.id}
                          targetType="message"
                        />
                      ) : null}
                    </article>
                  </li>
                );
              })}
              {visibleAttempt ? (
                <li className="flex justify-end" data-client-message-id={visibleAttempt.clientMessageId}>
                  <article className="max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-3 text-sm text-white opacity-75">
                    <p className="mb-1 text-xs text-indigo-100">
                      我 · {visibleAttempt.status === "sending" ? "发送中" : "发送失败"}
                    </p>
                    <SafeMessageText text={visibleAttempt.body} />
                    {visibleAttempt.status === "failed" ? (
                      <button
                        className="mt-2 text-xs font-semibold text-white underline"
                        onClick={retry}
                        type="button"
                      >
                        重试
                      </button>
                    ) : null}
                  </article>
                </li>
              ) : null}
            </ol>
          )}
        </section>

        <footer className="border-t border-slate-200 p-4">
          {latestMessageId ? (
            <form action={clearFormAction} className="mb-3 flex items-center justify-between gap-3">
              <input name="conversationId" type="hidden" value={conversationId} />
              <input name="throughMessageId" type="hidden" value={latestMessageId} />
              <button
                className="text-xs font-semibold text-slate-600 underline disabled:opacity-50"
                disabled={clearing}
                type="submit"
              >
                清除我的历史
              </button>
              {clearState.status !== "idle" ? (
                <span aria-live="polite" className="text-xs text-slate-500">
                  {clearState.message}
                </span>
              ) : null}
            </form>
          ) : null}
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendFormAction(new FormData(event.currentTarget));
            }}
          >
            <input name="conversationId" type="hidden" value={conversationId} />
            <label className="sr-only" htmlFor="direct-message-body">消息</label>
            <textarea
              aria-label="消息"
              className="min-h-24 w-full resize-y rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 disabled:bg-slate-100"
              disabled={sendStatus !== "allowed"}
              id="direct-message-body"
              maxLength={8000}
              name="body"
              onChange={(event) => setBody(event.target.value)}
              placeholder="输入消息"
              value={body}
            />
            <div className="flex items-center justify-between gap-3">
              <span className={bodyLength > 4000 ? "text-xs text-rose-700" : "text-xs text-slate-500"}>
                {bodyLength}/4000
              </span>
              <button
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={sending || bodyInvalid || sendStatus !== "allowed"}
                type="submit"
              >
                {sending ? "发送中…" : "发送"}
              </button>
            </div>
            {sendState.status !== "idle" ? (
              <p aria-live="polite" className="text-sm text-slate-600">
                {sendState.message}
              </p>
            ) : null}
          </form>
        </footer>
      </div>
    </main>
  );
}
