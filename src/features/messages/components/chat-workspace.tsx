"use client";

import { ChevronLeft, SendHorizontal } from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  Avatar,
  ChatMessageRow,
  shouldShowTimeDivider,
  TimeDivider,
} from "@/components/ui/chat";

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
    attempts,
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
  const visibleAttempts = attempts.filter((attempt) => !sync.messages.some(
    (message) => message.clientMessageId === attempt.clientMessageId,
  ));

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
        ? "当前好友关系或学校权限不允许发送新消息，历史仍可查看。"
        : null;

  // 新消息到来时，只有原本就停在底部附近才跟着滚到底；加载更早消息时保持位置。
  const scrollRef = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);
  const itemCount = sync.messages.length + visibleAttempts.length;
  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [itemCount]);
  const loadOlderKeepingPosition = async () => {
    const list = scrollRef.current;
    const distanceFromBottom = list ? list.scrollHeight - list.scrollTop : 0;
    stickToBottom.current = false;
    await sync.loadOlder();
    requestAnimationFrame(() => {
      if (list) list.scrollTop = list.scrollHeight - distanceFromBottom;
    });
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-card px-3 md:px-4">
        <Link
          aria-label="返回好友"
          className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink"
          href="/friends"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </Link>
        <Avatar id={null} name={otherDisplayName} size={28} />
        <h1 className="min-w-0 truncate text-sm font-semibold text-ink">
          {otherDisplayName}
        </h1>
        <span className="ml-auto shrink-0 text-xs text-muted">
          {sync.connected ? "实时连接" : "正在同步"}
        </span>
      </header>

      {restriction ? (
        <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {restriction}
        </p>
      ) : null}

      <section
        aria-label="消息记录"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-chat px-4 py-3"
        onScroll={(event) => {
          const list = event.currentTarget;
          stickToBottom.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}
        ref={scrollRef}
      >
        {sync.hasOlderMessages ? (
          <button
            className="mx-auto mb-2 block rounded-full border border-line bg-card px-4 py-1 text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
            disabled={sync.loadingOlder}
            onClick={() => void loadOlderKeepingPosition()}
            type="button"
          >
            {sync.loadingOlder ? "加载中…" : "加载更早消息"}
          </button>
        ) : null}
        {sync.messages.length === 0 && visibleAttempts.length === 0 ? (
          <p className="m-auto py-12 text-center text-sm text-muted">
            清除位置之后还没有消息。
          </p>
        ) : (
          <ol className="flex flex-col">
            {sync.messages.map((message, index) => (
              <DirectMessageItem
                key={message.id}
                message={message}
                own={message.senderId === currentUserId}
                previousAt={sync.messages[index - 1]?.createdAt}
                reportAction={reportAction}
              />
            ))}
            {visibleAttempts.map((attempt) => (
              <ChatMessageRow
                body={<SafeMessageText text={attempt.body} />}
                data-client-message-id={attempt.clientMessageId}
                dimmed
                footer={
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-chat-meta">
                    <span>
                      {attempt.status === "failed" ? (
                        <span aria-label="发送失败" className="mr-1 font-bold text-badge" role="img">
                          !
                        </span>
                      ) : null}
                      我 · {attempt.status === "sending" ? "发送中" : "发送失败"}
                    </span>
                    {attempt.retryable ? (
                      <button
                        className="font-semibold text-badge underline"
                        onClick={() => retry(attempt.clientMessageId)}
                        type="button"
                      >
                        重试
                      </button>
                    ) : null}
                  </span>
                }
                key={attempt.clientMessageId}
                own
                senderId={currentUserId}
                senderName="我"
              />
            ))}
          </ol>
        )}
      </section>

      <footer className="shrink-0 border-t border-line bg-bar px-3 py-2.5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            stickToBottom.current = true;
            sendFormAction(new FormData(event.currentTarget));
          }}
        >
          <input name="conversationId" type="hidden" value={conversationId} />
          <label className="sr-only" htmlFor="direct-message-body">消息</label>
          <div className="flex items-end gap-2">
            <textarea
              aria-label="消息"
              className="max-h-40 min-h-10 min-w-0 flex-1 resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-[22px] text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
              disabled={sendStatus !== "allowed"}
              id="direct-message-body"
              maxLength={8000}
              name="body"
              onChange={(event) => setBody(event.target.value)}
              placeholder="输入消息"
              rows={1}
              value={body}
            />
            <button
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-40"
              disabled={sending || bodyInvalid || sendStatus !== "allowed"}
              type="submit"
            >
              <SendHorizontal size={15} strokeWidth={1.75} />
              {sending ? "发送中…" : "发送"}
            </button>
          </div>
          {sendState.status !== "idle" ? (
            <p aria-live="polite" className="mt-1.5 text-xs text-muted">
              {sendState.message}
            </p>
          ) : null}
        </form>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          {latestMessageId ? (
            <form action={clearFormAction} className="flex min-w-0 items-center gap-3">
              <input name="conversationId" type="hidden" value={conversationId} />
              <input name="throughMessageId" type="hidden" value={latestMessageId} />
              <button
                className="shrink-0 text-xs text-muted underline hover:text-ink disabled:opacity-50"
                disabled={clearing}
                type="submit"
              >
                清除我的历史
              </button>
              {clearState.status !== "idle" ? (
                <span aria-live="polite" className="truncate text-xs text-muted">
                  {clearState.message}
                </span>
              ) : null}
            </form>
          ) : (
            <span />
          )}
          <span className={bodyLength > 4000 ? "text-xs text-badge" : "text-xs text-muted"}>
            {bodyLength}/4000
          </span>
        </div>
      </footer>
    </main>
  );
}

function DirectMessageItem({
  message,
  own,
  previousAt,
  reportAction,
}: {
  message: DirectMessage;
  own: boolean;
  previousAt?: string;
  reportAction: ReportAction;
}) {
  return (
    <>
      {shouldShowTimeDivider(previousAt, message.createdAt) ? (
        <TimeDivider iso={message.createdAt} />
      ) : null}
      <ChatMessageRow
        body={<SafeMessageText text={message.body} />}
        footer={
          !own && message.senderId ? (
            <div className="mt-0.5 text-xs text-chat-meta">
              <ReportForm
                action={reportAction}
                label="举报消息"
                targetId={message.id}
                targetType="message"
              />
            </div>
          ) : null
        }
        own={own}
        senderId={message.senderId}
        senderName={own ? "我" : message.senderDisplayName}
      />
    </>
  );
}
