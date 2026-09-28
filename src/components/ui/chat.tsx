import type { ReactNode } from "react";

/**
 * 课程群聊和私聊共用的聊天展示组件：圆角方形头像、带小尾巴的气泡、居中时间分隔。
 * 都是无状态展示组件，数据由上层传入。
 */

/** 按用户 ID 稳定地取 8 种颜色之一，同一个人在任何地方颜色都一样。 */
export function avatarColorFor(id: string | null): string {
  if (!id) return "var(--muted)";
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return `var(--course-${Math.abs(hash) % 8})`;
}

export function Avatar({
  id,
  name,
  size = 36,
}: {
  id: string | null;
  name: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 select-none items-center justify-center rounded-md font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: avatarColorFor(id),
      }}
    >
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}

/** 两条消息间隔超过 5 分钟（或是第一条）时显示时间分隔。 */
export function shouldShowTimeDivider(previous: string | undefined, current: string): boolean {
  if (!previous) return true;
  return new Date(current).getTime() - new Date(previous).getTime() > 5 * 60 * 1000;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 今天显示「14:30」，昨天显示「昨天 14:30」，更早显示「9月24日 14:30」。 */
export function formatChatTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear()
    ? `${day} ${time}`
    : `${date.getFullYear()}年${day} ${time}`;
}

export function TimeDivider({ iso }: { iso: string }) {
  return (
    <li aria-hidden="true" className="flex justify-center pb-1.5 pt-2.5">
      <span className="text-xs text-chat-meta">{formatChatTime(iso)}</span>
    </li>
  );
}

/**
 * 一条消息：头像 + （别人的消息带昵称）+ 气泡。自己的消息靠右。
 * footer 用于放「发送中 / 发送失败 · 重试」、举报这类气泡下方的内容。
 */
export function ChatMessageRow({
  own,
  senderId,
  senderName,
  body,
  dimmed = false,
  footer,
  ...rest
}: {
  own: boolean;
  senderId: string | null;
  senderName: string;
  /** 气泡内容：纯文本，或经过安全处理的富文本（例如带链接的私聊消息）。 */
  body: ReactNode;
  dimmed?: boolean;
  footer?: ReactNode;
} & React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li className={`flex items-start gap-2.5 py-0.5 ${own ? "flex-row-reverse" : ""}`} {...rest}>
      <Avatar id={senderId} name={senderName} />
      <div className={`flex min-w-0 max-w-[min(75%,560px)] flex-col ${own ? "items-end" : "items-start"}`}>
        {!own ? (
          <span className="mb-0.5 max-w-full truncate text-xs font-medium text-chat-meta">
            {senderName}
          </span>
        ) : null}
        <div
          className={`whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-[22px] [overflow-wrap:anywhere] ${
            own
              ? "rounded-[6px_6px_2px_6px] bg-bubble-me text-white"
              : "rounded-[6px_6px_6px_2px] border border-line bg-bubble-other text-ink"
          } ${dimmed ? "opacity-70" : ""}`}
        >
          {body}
        </div>
        {footer}
      </div>
    </li>
  );
}
