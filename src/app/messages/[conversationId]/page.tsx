import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import { notFound, redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";
import {
  clearDirectConversationAction,
  markDirectMessageReadAction,
  sendDirectMessageAction,
} from "@/features/messages/actions";
import { ChatWorkspace } from "@/features/messages/components/chat-workspace";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";
import { submitBehaviorReportAction } from "@/features/reporting/actions";

export const dynamic = "force-dynamic";

export default async function MessagePage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.onboardingComplete) redirect("/onboarding/profile");

  const { conversationId } = await params;
  const service = await createProductionDirectMessageService();
  // 会话信息与最近消息互不依赖，同时取。两者各自由数据库授权，任何一个没有加载成功
  // 都是 404，页面不会渲染没有通过授权的内容。
  const [conversationResult, messageResult] = await Promise.all([
    service.getConversation(conversationId),
    service.listMessages(conversationId, { direction: "before", limit: 50 }),
  ]);
  if (conversationResult.status !== "loaded") notFound();
  if (messageResult.status !== "loaded") notFound();

  return (
    <>
      <SchoolTestBanner member={member} />
    <ChatWorkspace
      clearAction={clearDirectConversationAction}
      conversationId={conversationId}
      currentUserId={member.userId}
      initialHasOlderMessages={messageResult.messages.length === 50}
      initialMessages={messageResult.messages}
      markReadAction={markDirectMessageReadAction}
      otherDisplayName={conversationResult.conversation.otherDisplayName}
      reportAction={submitBehaviorReportAction}
      sendAction={sendDirectMessageAction}
      sendStatus={conversationResult.conversation.sendStatus}
    />
    </>
  );
}
