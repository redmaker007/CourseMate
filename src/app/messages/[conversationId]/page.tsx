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
  const conversationResult = await service.getConversation(conversationId);
  if (conversationResult.status !== "loaded") notFound();

  const messageResult = await service.listMessages(conversationId, {
    direction: "before",
    limit: 50,
  });
  if (messageResult.status !== "loaded") notFound();

  return (
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
  );
}
