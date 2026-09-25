// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const service = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
}));
const production = vi.hoisted(() => ({ createService: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: production.createService,
}));
vi.mock("@/features/messages/actions", () => ({
  sendDirectMessageAction: vi.fn(),
  markDirectMessageReadAction: vi.fn(),
  clearDirectConversationAction: vi.fn(),
}));
vi.mock("@/features/messages/components/chat-workspace", () => ({
  ChatWorkspace: ({ otherDisplayName, initialMessages }: {
    otherDisplayName: string;
    initialMessages: unknown[];
  }) => <div>{otherDisplayName}:{initialMessages.length}</div>,
}));

import MessagePage from "./page";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("direct message page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({
      userId: "alice",
      onboardingComplete: true,
    });
    production.createService.mockResolvedValue(service);
    service.getConversation.mockResolvedValue({
      status: "loaded",
      conversation: {
        conversationId: CONVERSATION_ID,
        otherDisplayName: "Bob",
        sendStatus: "allowed",
      },
    });
    service.listMessages.mockResolvedValue({
      status: "loaded",
      messages: [{ id: "1" }],
    });
  });

  afterEach(cleanup);

  it("loads authorized metadata and history through the same message service", async () => {
    render(
      await MessagePage({
        params: Promise.resolve({ conversationId: CONVERSATION_ID }),
      }),
    );

    expect(service.getConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.listMessages).toHaveBeenCalledWith(CONVERSATION_ID, {
      direction: "before",
      limit: 50,
    });
    expect(screen.getByText("Bob:1")).toBeTruthy();
  });

  it("does not render a conversation that RLS does not authorize", async () => {
    service.getConversation.mockResolvedValue({ status: "not_available" });
    service.listMessages.mockResolvedValue({ status: "not_available" });

    await expect(
      MessagePage({ params: Promise.resolve({ conversationId: CONVERSATION_ID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("两个请求同时发出，而不是等会话信息回来再取消息", { timeout: 1000 }, async () => {
    // 每一路都要等到两路都已开始才会返回；若是串行发起，第一路永远等不到第二路，
    // 测试会因超时失败。
    const started = new Set<string>();
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begin = (name: string) => {
      started.add(name);
      if (started.size === 2) release();
      return allStarted;
    };
    service.getConversation.mockImplementation(async () => {
      await begin("conversation");
      return {
        status: "loaded",
        conversation: {
          conversationId: CONVERSATION_ID,
          otherDisplayName: "Bob",
          sendStatus: "allowed",
        },
      };
    });
    service.listMessages.mockImplementation(async () => {
      await begin("messages");
      return { status: "loaded", messages: [{ id: "1" }] };
    });

    render(
      await MessagePage({
        params: Promise.resolve({ conversationId: CONVERSATION_ID }),
      }),
    );

    expect([...started].sort()).toEqual(["conversation", "messages"]);
  });

  it("会话可用但消息没有加载成功时同样是 404，不渲染半个页面", async () => {
    service.listMessages.mockResolvedValue({ status: "temporarily_unavailable" });

    await expect(
      MessagePage({ params: Promise.resolve({ conversationId: CONVERSATION_ID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("没有完成 onboarding 的成员不会去取会话与消息", async () => {
    auth.getCurrentMember.mockResolvedValue({
      userId: "alice",
      onboardingComplete: false,
    });

    await expect(
      MessagePage({ params: Promise.resolve({ conversationId: CONVERSATION_ID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding/profile");
    expect(service.getConversation).not.toHaveBeenCalled();
    expect(service.listMessages).not.toHaveBeenCalled();
  });
});
