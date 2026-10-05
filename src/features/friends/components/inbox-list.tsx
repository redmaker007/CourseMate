"use client";

import { ChevronRight, Plus, Search, ShieldOff, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/chat";
import { formatBadge } from "@/features/shell/navigation";

import type { InboxData } from "../inbox";

type Tab = "messages" | "classmates";

/** 当前路径属于哪个标签：好友管理类页面默认停在「同学」。 */
export function defaultInboxTab(pathname: string): Tab {
  return pathname.startsWith("/messages/") || pathname === "/friends" ? "messages" : "classmates";
}

function Badge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-[10px] font-bold leading-none text-white ${className}`}
    >
      {formatBadge(count)}
    </span>
  );
}

/**
 * 「消息与好友」左栏（参照原型的 300px 会话列表）：
 * 「消息」列出私聊会话，「同学」放新的朋友、屏蔽与拉黑、我的好友。
 */
export function InboxList({ conversations, friends, pendingIncoming, unavailable }: InboxData) {
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>(() => defaultInboxTab(pathname));
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  const matches = (name: string) => !keyword || name.toLowerCase().includes(keyword);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 border-b border-line" role="tablist">
        {(
          [
            ["messages", "消息"],
            ["classmates", "同学"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className={`relative flex-1 border-b-2 py-3 text-sm font-medium transition ${
              tab === value ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            type="button"
          >
            {label}
            {value === "classmates" && pendingIncoming > 0 ? (
              <Badge className="absolute right-[calc(50%-2.25rem)] top-2" count={pendingIncoming} />
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 gap-2 border-b border-line p-2.5">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            size={13}
          />
          <input
            aria-label="按名字筛选"
            className="h-8 w-full rounded-lg bg-canvas pl-7 pr-2 text-sm text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-brand/30"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            type="search"
            value={query}
          />
        </div>
        <Link
          aria-label="添加好友"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted hover:text-ink"
          href="/friends/search"
          title="添加好友"
        >
          <Plus size={14} />
        </Link>
      </div>

      {unavailable ? (
        <p className="shrink-0 bg-warn-soft px-4 py-2 text-xs text-warn">
          部分数据暂时无法加载，请稍后刷新。
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "messages" ? (
          <ConversationRows
            conversations={conversations.filter((conversation) => matches(conversation.name))}
            empty={conversations.length === 0}
            onShowClassmates={() => setTab("classmates")}
            pathname={pathname}
          />
        ) : (
          <ClassmateRows
            friends={friends.filter((friend) => matches(friend.name))}
            pathname={pathname}
            pendingIncoming={pendingIncoming}
          />
        )}
      </div>
    </div>
  );
}

function ConversationRows({
  conversations,
  empty,
  onShowClassmates,
  pathname,
}: {
  conversations: InboxData["conversations"];
  empty: boolean;
  onShowClassmates: () => void;
  pathname: string;
}) {
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-ink">还没有私信</p>
        <p className="text-sm text-muted">加好友后就能在这里私聊，也可以在课程群里找同学。</p>
        <button
          className="mt-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          onClick={onShowClassmates}
          type="button"
        >
          查看同学
        </button>
      </div>
    );
  }
  if (conversations.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted">没有匹配的会话</p>;
  }

  return (
    <ul>
      {conversations.map((conversation) => {
        const href = `/messages/${conversation.conversationId}`;
        const active = pathname === href;
        // 正在看的会话不再显示未读角标，免得和右边已读的消息对不上
        const unread = active ? 0 : conversation.unread;
        return (
          <li key={conversation.conversationId}>
            <Link
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 px-4 py-2.5 transition ${
                active ? "bg-panel" : "hover:bg-panel/60"
              }`}
              href={href}
            >
              <span className="relative shrink-0">
                <Avatar id={conversation.memberId} name={conversation.name} size={44} />
                <Badge className="absolute -right-1 -top-1" count={unread} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {conversation.name}
                </span>
                <span
                  className={`block truncate text-[13px] ${
                    conversation.blocked ? "text-badge" : "text-muted"
                  }`}
                >
                  {conversation.subtitle}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function EntryRow({
  href,
  icon,
  label,
  badge = 0,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-4 py-2.5 transition ${active ? "bg-panel" : "hover:bg-panel/60"}`}
      href={href}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <Badge count={badge} />
      <ChevronRight className="text-muted" size={14} />
    </Link>
  );
}

function ClassmateRows({
  friends,
  pathname,
  pendingIncoming,
}: {
  friends: InboxData["friends"];
  pathname: string;
  pendingIncoming: number;
}) {
  return (
    <>
      <div className="divide-y divide-line border-b border-line">
        <EntryRow
          active={pathname === "/friends/requests"}
          badge={pendingIncoming}
          href="/friends/requests"
          icon={<UserPlus size={16} />}
          label="新的朋友"
        />
        <EntryRow
          active={pathname === "/friends/filtered"}
          href="/friends/filtered"
          icon={<ShieldOff size={16} />}
          label="屏蔽与拉黑"
        />
      </div>
      <p className="sticky top-0 border-b border-line bg-card px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted">
        我的好友 · {friends.length}
      </p>
      {friends.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">还没有好友</p>
      ) : (
        <ul className="divide-y divide-line">
          {friends.map((friend) => {
            const href = `/friends/${friend.memberId}`;
            return (
              <li key={friend.memberId}>
                <Link
                  aria-current={pathname === href ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-2.5 transition ${
                    pathname === href ? "bg-panel" : "hover:bg-panel/60"
                  }`}
                  href={href}
                >
                  <Avatar id={friend.memberId} name={friend.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{friend.name}</span>
                    <span className="block truncate text-xs text-muted">{friend.detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
