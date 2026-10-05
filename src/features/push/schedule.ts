import "server-only";

import { after } from "next/server";

import { createProductionPushNotifier } from "./production-push-notifier";

/**
 * 响应发出之后再推送，不拖慢发消息。after 在请求范围之外会抛错，推送是附带功能，
 * 这里一并吞掉，绝不让它影响发送本身。
 */
function runAfterResponse(task: (notifier: NonNullable<ReturnType<typeof createProductionPushNotifier>>) => Promise<void>) {
  try {
    after(async () => {
      const notifier = createProductionPushNotifier();
      if (notifier) await task(notifier);
    });
  } catch {
    // 不在请求范围内（例如单元测试）：不推送
  }
}

export function scheduleDirectMessagePush(messageId: string, conversationId: string) {
  runAfterResponse((notifier) => notifier.notifyDirectMessage(messageId, conversationId));
}

export function scheduleFriendRequestPush(requestId: string) {
  runAfterResponse((notifier) => notifier.notifyFriendRequest(requestId));
}
