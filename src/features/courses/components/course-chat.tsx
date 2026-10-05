"use client";

import { SendHorizontal } from "lucide-react";
import { useCallback, useLayoutEffect, useRef } from "react";

import {
  ChatMessageRow,
  shouldShowTimeDivider,
  TimeDivider,
} from "@/components/ui/chat";
import { useMessageSend } from "@/features/messages/use-message-send";

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
  const formRef = useRef<HTMLFormElement>(null);
  const onSaved = useCallback(
    (message: SyncedCourseMessage) => mergeIncoming([message]),
    [mergeIncoming],
  );
  const onStart = useCallback(() => formRef.current?.reset(), []);
  const {
    attempts,
    formAction,
    pending,
    retry,
    state: actionState,
  } = useMessageSend({
    action: sendCourseMessageAction,
    fixedFields: { courseId, conversationId },
    initialState: initialCourseMessageActionState,
    onSaved,
    onStart,
  });
  const visibleAttempts = attempts.filter((attempt) => !messages.some(
    (message) => message.clientMessageId === attempt.clientMessageId,
  ));

  // 新消息到来时，只有原本就停在底部附近才跟着滚到底，避免打断正在往上翻的人。
  const scrollRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const itemCount = messages.length + visibleAttempts.length;
  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [itemCount]);

  // 加载更早消息会在顶部插入内容，保持当前看到的位置不跳动。
  const loadOlderKeepingPosition = async () => {
    const list = scrollRef.current;
    const distanceFromBottom = list ? list.scrollHeight - list.scrollTop : 0;
    stickToBottom.current = false;
    await loadOlder();
    requestAnimationFrame(() => {
      if (list) list.scrollTop = list.scrollHeight - distanceFromBottom;
    });
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p
        aria-live="polite"
        className="shrink-0 border-b border-line bg-card px-4 py-1 text-xs text-muted"
      >
        {archived
          ? "课程已归档，聊天记录仅供查看。"
          : connected
            ? "实时连接已建立"
            : "实时连接中断，页面可见时将自动轮询新消息。"}
      </p>

      <ol
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-chat px-4 py-3"
        onScroll={(event) => {
          const list = event.currentTarget;
          stickToBottom.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}
        ref={scrollRef}
      >
        {hasOlderMessages ? (
          <li className="flex justify-center pb-2">
            <button
              className="rounded-full border border-line bg-card px-4 py-1 text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
              disabled={loadingOlder}
              onClick={() => void loadOlderKeepingPosition()}
              type="button"
            >
              {loadingOlder ? "加载中……" : "加载更早消息"}
            </button>
          </li>
        ) : null}

        {messages.length || visibleAttempts.length ? (
          <>
            {messages.map((message, index) => (
              <MessageWithDivider
                key={message.id}
                message={message}
                own={message.senderId === currentUserId}
                previousAt={messages[index - 1]?.createdAt}
              />
            ))}
            {visibleAttempts.map((attempt) => (
              <ChatMessageRow
                body={attempt.body}
                data-client-message-id={attempt.clientMessageId}
                dimmed
                footer={
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-chat-meta">
                    {attempt.status === "sending" ? "发送中" : "发送失败"}
                    {attempt.status === "failed" ? (
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
          </>
        ) : (
          <li className="m-auto py-10 text-center text-sm text-muted">还没有消息，打个招呼吧。</li>
        )}
      </ol>

      {!archived ? (
        <form
          className="shrink-0 border-t border-line bg-bar px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            stickToBottom.current = true;
            formAction(new FormData(event.currentTarget));
          }}
          ref={formRef}
        >
          <input name="courseId" type="hidden" value={courseId} />
          <input name="conversationId" type="hidden" value={conversationId} />
          <label className="sr-only" htmlFor="course-message-body">
            消息内容
          </label>
          <div className="flex items-end gap-2">
            <textarea
              className="max-h-40 min-h-10 min-w-0 flex-1 resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-[22px] text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
              disabled={pending}
              id="course-message-body"
              maxLength={4000}
              name="body"
              placeholder="发送纯文字消息……"
              required
              rows={1}
            />
            <button
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-40"
              disabled={pending}
              type="submit"
            >
              <SendHorizontal size={15} strokeWidth={1.75} />
              {pending ? "发送中……" : "发送"}
            </button>
          </div>
          {actionState.status === "invalid" || actionState.status === "unavailable" ? (
            <p className="mt-1.5 text-xs text-badge" role="status">
              {actionState.message}
            </p>
          ) : (
            <p className="sr-only" role="status" />
          )}
        </form>
      ) : null}
    </section>
  );
}

function MessageWithDivider({
  message,
  own,
  previousAt,
}: {
  message: SyncedCourseMessage;
  own: boolean;
  previousAt?: string;
}) {
  return (
    <>
      {shouldShowTimeDivider(previousAt, message.createdAt) ? (
        <TimeDivider iso={message.createdAt} />
      ) : null}
      <ChatMessageRow
        body={message.body}
        own={own}
        senderId={message.senderId}
        senderName={message.senderName}
      />
    </>
  );
}
