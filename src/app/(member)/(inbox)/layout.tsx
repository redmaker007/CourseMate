import { getCurrentMember } from "@/features/auth/session";
import { InboxList } from "@/features/friends/components/inbox-list";
import { InboxShell } from "@/features/friends/components/inbox-shell";
import { loadInboxData } from "@/features/friends/inbox";

/**
 * 「消息与好友」的两栏布局：左栏会话 / 同学列表，右栏是私聊、好友申请、好友详情等。
 *
 * 和 (member)/layout.tsx 一样只负责展示，访问控制仍由每个页面自己做。
 * 未登录或资料未补全时不取数据，交给页面去跳转。
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member?.onboardingComplete) return children;

  const data = await loadInboxData();
  return <InboxShell list={<InboxList {...data} />}>{children}</InboxShell>;
}
