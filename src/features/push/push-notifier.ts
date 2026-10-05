export type PushTarget = {
  endpoint: string;
  p256dh: string;
  authSecret: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export type PushNotifierDeps = {
  claimDirectMessage(messageId: string): Promise<PushTarget[]>;
  claimFriendRequest(requestId: string): Promise<PushTarget[]>;
  send(target: PushTarget, payload: PushPayload): Promise<void>;
  drop(endpoint: string): Promise<void>;
};

const MESSAGE_ID = /^[1-9][0-9]*$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 推送服务返回"订阅不存在 / 已过期"时的状态码。 */
function isGone(error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * 通知正文只写固定文案，不带消息内容或发送者：锁屏上谁都能看到。
 * 任何一步失败都吞掉：推送是附带功能，不能让发消息、发好友申请失败。
 */
export function createPushNotifier(deps: PushNotifierDeps) {
  async function deliver(targets: PushTarget[], payload: PushPayload) {
    await Promise.allSettled(
      targets.map(async (target) => {
        try {
          await deps.send(target, payload);
        } catch (error) {
          if (isGone(error)) await deps.drop(target.endpoint);
        }
      }),
    );
  }

  return {
    async notifyDirectMessage(messageId: string, conversationId: string) {
      if (!MESSAGE_ID.test(messageId) || !UUID.test(conversationId)) return;
      try {
        const targets = await deps.claimDirectMessage(messageId);
        if (targets.length === 0) return;
        await deliver(targets, {
          title: "CourseMate",
          body: "你有一条新消息",
          url: `/messages/${conversationId}`,
          tag: `dm:${conversationId}`,
        });
      } catch {
        // 见上：推送失败不影响主流程
      }
    },

    async notifyFriendRequest(requestId: string) {
      if (!UUID.test(requestId)) return;
      try {
        const targets = await deps.claimFriendRequest(requestId);
        if (targets.length === 0) return;
        await deliver(targets, {
          title: "CourseMate",
          body: "你收到了新的好友申请",
          url: "/friends/requests",
          tag: "friend-request",
        });
      } catch {
        // 见上：推送失败不影响主流程
      }
    },
  };
}

export type PushNotifier = ReturnType<typeof createPushNotifier>;
