import { NextResponse } from "next/server";

import { getCurrentMember } from "@/features/auth/session";
import { createProductionDirectMessageService } from "@/features/messages/production-direct-message-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_ID_PATTERN = /^[1-9][0-9]*$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!member.onboardingComplete) {
    return NextResponse.json({ error: "onboarding_required" }, { status: 403 });
  }

  const { conversationId } = await params;
  const search = new URL(request.url).searchParams;
  const before = search.get("before");
  const after = search.get("after");
  if (
    !UUID_PATTERN.test(conversationId) ||
    (before !== null && after !== null) ||
    (before !== null && !MESSAGE_ID_PATTERN.test(before)) ||
    (after !== null && !MESSAGE_ID_PATTERN.test(after))
  ) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const service = await createProductionDirectMessageService();
  const result = await service.listMessages(conversationId, {
    direction: before === null ? "after" : "before",
    ...(before ?? after ? { cursor: before ?? after ?? undefined } : {}),
    limit: 100,
  });
  if (result.status !== "loaded") {
    return NextResponse.json({ error: result.status }, { status: 403 });
  }
  return NextResponse.json({
    messages: result.messages,
    hasMore: result.messages.length === 100,
  });
}
