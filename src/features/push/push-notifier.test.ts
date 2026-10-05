import { describe, expect, it, vi } from "vitest";

import { createPushNotifier, type PushNotifierDeps, type PushTarget } from "./push-notifier";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET: PushTarget = { endpoint: "https://push.example/a", p256dh: "p", authSecret: "s" };

function setup(overrides: Partial<PushNotifierDeps> = {}) {
  const deps: PushNotifierDeps = {
    claimDirectMessage: vi.fn(async () => [TARGET]),
    claimFriendRequest: vi.fn(async () => [TARGET]),
    send: vi.fn(async () => undefined),
    drop: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, notifier: createPushNotifier(deps) };
}

describe("push notifier", () => {
  it("私聊通知只带固定文案和会话路径，不含消息内容", async () => {
    const { deps, notifier } = setup();
    await notifier.notifyDirectMessage("42", CONVERSATION_ID);
    expect(deps.claimDirectMessage).toHaveBeenCalledWith("42");
    expect(deps.send).toHaveBeenCalledWith(TARGET, {
      title: "CourseMate",
      body: "你有一条新消息",
      url: `/messages/${CONVERSATION_ID}`,
      tag: `dm:${CONVERSATION_ID}`,
    });
  });

  it("好友申请通知指向申请页", async () => {
    const { deps, notifier } = setup();
    await notifier.notifyFriendRequest(REQUEST_ID);
    expect(deps.send).toHaveBeenCalledWith(
      TARGET,
      expect.objectContaining({ body: "你收到了新的好友申请", url: "/friends/requests" }),
    );
  });

  it("参数格式不对时不查询也不发送", async () => {
    const { deps, notifier } = setup();
    await notifier.notifyDirectMessage("0", CONVERSATION_ID);
    await notifier.notifyDirectMessage("42; drop", CONVERSATION_ID);
    await notifier.notifyDirectMessage("42", "not-a-uuid");
    await notifier.notifyFriendRequest("nope");
    expect(deps.claimDirectMessage).not.toHaveBeenCalled();
    expect(deps.claimFriendRequest).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("数据库没有返回订阅（不该通知或已通知过）时不发送", async () => {
    const { deps, notifier } = setup({ claimDirectMessage: vi.fn(async () => []) });
    await notifier.notifyDirectMessage("42", CONVERSATION_ID);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("订阅已失效（404 / 410）时清除；其他错误保留订阅", async () => {
    const gone = setup({
      send: vi.fn(async () => {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }),
    });
    await gone.notifier.notifyDirectMessage("42", CONVERSATION_ID);
    expect(gone.deps.drop).toHaveBeenCalledWith(TARGET.endpoint);

    const flaky = setup({
      send: vi.fn(async () => {
        throw Object.assign(new Error("server error"), { statusCode: 500 });
      }),
    });
    await flaky.notifier.notifyDirectMessage("42", CONVERSATION_ID);
    expect(flaky.deps.drop).not.toHaveBeenCalled();
  });

  it("任何一步抛错都不会向外传播", async () => {
    const { notifier } = setup({
      claimDirectMessage: vi.fn(async () => {
        throw new Error("db down");
      }),
      claimFriendRequest: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(notifier.notifyDirectMessage("42", CONVERSATION_ID)).resolves.toBeUndefined();
    await expect(notifier.notifyFriendRequest(REQUEST_ID)).resolves.toBeUndefined();
  });

  it("多个设备一个失败不影响其他设备", async () => {
    const second: PushTarget = { ...TARGET, endpoint: "https://push.example/b" };
    const send = vi.fn(async (target: PushTarget) => {
      if (target.endpoint === TARGET.endpoint) throw new Error("boom");
    });
    const { notifier } = setup({ claimDirectMessage: vi.fn(async () => [TARGET, second]), send });
    await notifier.notifyDirectMessage("42", CONVERSATION_ID);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
