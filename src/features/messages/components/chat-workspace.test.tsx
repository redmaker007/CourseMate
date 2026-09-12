// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectMessage } from "../direct-message-service";
import type { DirectMessageActionState } from "../message-action-state";

const sync = vi.hoisted(() => ({ useDirectMessageSync: vi.fn() }));
vi.mock("../use-direct-message-sync", () => sync);

import { ChatWorkspace } from "./chat-workspace";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MESSAGE: DirectMessage = {
  id: "42",
  conversationId: CONVERSATION_ID,
  senderId: "bob",
  senderDisplayName: "Bob",
  body: "hello https://example.com",
  createdAt: "2026-09-11T00:00:00Z",
};
const NEXT_MESSAGE: DirectMessage = { ...MESSAGE, id: "43", body: "next" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => CLIENT_MESSAGE_ID });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("chat workspace", () => {
  it("shows history, safe links and marks only the displayed latest message read", async () => {
    const markReadAction = vi.fn().mockResolvedValue("updated");
    sync.useDirectMessageSync.mockReturnValue({
      messages: [MESSAGE],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
    });

    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[MESSAGE]}
        markReadAction={markReadAction}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={vi.fn()}
        sendStatus="allowed"
      />,
    );

    expect(screen.getByRole("heading", { name: "Bob" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "举报消息" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://example.com" }))
      .toHaveProperty("rel", "noopener noreferrer");
    await waitFor(() =>
      expect(markReadAction).toHaveBeenCalledWith(CONVERSATION_ID, "42"),
    );
    expect(screen.queryByText(/已读/)).toBeNull();
  });

  it("retries the same latest message after marking read fails", async () => {
    const markReadAction = vi
      .fn()
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("updated");
    sync.useDirectMessageSync.mockReturnValue({
      messages: [MESSAGE],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
    });

    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[MESSAGE]}
        markReadAction={markReadAction}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={vi.fn()}
        sendStatus="allowed"
      />,
    );

    await waitFor(() => expect(markReadAction).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(markReadAction).toHaveBeenCalledTimes(2));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(markReadAction).toHaveBeenCalledTimes(2);
  });

  it("does not let an older successful request move the local read cursor backward", async () => {
    let resolveOlder!: (status: string) => void;
    let resolveLatest!: (status: string) => void;
    const markReadAction = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveOlder = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveLatest = resolve; }),
      );
    const syncResult = {
      messages: [MESSAGE],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
    };
    sync.useDirectMessageSync.mockReturnValue(syncResult);
    const props = {
      clearAction: vi.fn(),
      conversationId: CONVERSATION_ID,
      currentUserId: "alice",
      initialHasOlderMessages: false,
      initialMessages: [MESSAGE],
      markReadAction,
      otherDisplayName: "Bob",
      reportAction: vi.fn(),
      sendAction: vi.fn(),
      sendStatus: "allowed" as const,
    };
    const { rerender } = render(<ChatWorkspace {...props} />);
    await waitFor(() => expect(markReadAction).toHaveBeenCalledTimes(1));

    sync.useDirectMessageSync.mockReturnValue({
      ...syncResult,
      messages: [MESSAGE, NEXT_MESSAGE],
    });
    rerender(<ChatWorkspace {...props} />);
    await waitFor(() => expect(markReadAction).toHaveBeenCalledTimes(2));
    await act(async () => { resolveLatest("updated"); });
    await act(async () => { resolveOlder("updated"); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });

    expect(markReadAction).toHaveBeenCalledTimes(2);
  });

  it("does not offer reporting on the current member's own message", () => {
    sync.useDirectMessageSync.mockReturnValue({
      messages: [{ ...MESSAGE, senderId: "alice" }],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
    });

    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[]}
        markReadAction={vi.fn().mockResolvedValue("updated")}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={vi.fn()}
        sendStatus="allowed"
      />,
    );

    expect(screen.queryByRole("button", { name: "举报消息" })).toBeNull();
  });

  it("shows a pending message immediately and retries a failure with the same id", async () => {
    let finish!: (state: {
      status: string;
      message: string;
      clientMessageId: string;
      attemptedBody: string;
    }) => void;
    const sendAction = vi.fn(
      (_previousState, _formData): Promise<{
        status: string;
        message: string;
        clientMessageId: string;
        attemptedBody: string;
      }> => {
        void _previousState;
        void _formData;
        return new Promise((resolve) => { finish = resolve; });
      },
    );
    sync.useDirectMessageSync.mockReturnValue({
      messages: [],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
      mergeIncoming: vi.fn(),
    });
    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[]}
        markReadAction={vi.fn()}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={sendAction}
        sendStatus="allowed"
      />,
    );

    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      const pending = document.querySelector(
        "[data-client-message-id]",
      );
      expect(pending?.textContent).toContain("hello");
      expect(pending?.textContent).toContain("发送中");
    });
    expect((input as HTMLTextAreaElement).value).toBe("");
    const firstForm = sendAction.mock.calls[0][1];
    const generatedId = String(firstForm.get("clientMessageId"));

    await act(async () => {
      finish({
        status: "temporarily_unavailable",
        message: "服务暂时不可用，请稍后重试。",
        clientMessageId: generatedId,
        attemptedBody: "hello",
      });
    });
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(2));
    const retryForm = sendAction.mock.calls[1][1];
    expect(retryForm.get("clientMessageId")).toBe(generatedId);
    expect(retryForm.get("body")).toBe("hello");
  });

  it("keeps earlier failed messages when a later send also fails", async () => {
    const ids = [
      CLIENT_MESSAGE_ID,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ];
    vi.stubGlobal("crypto", { randomUUID: () => ids.shift()! });
    let finish!: (state: DirectMessageActionState) => void;
    const sendAction = vi.fn((
      _previousState: DirectMessageActionState,
      _formData: FormData,
    ): Promise<DirectMessageActionState> => {
      void _previousState;
      void _formData;
      return new Promise((resolve) => { finish = resolve; });
    });
    sync.useDirectMessageSync.mockReturnValue({
      messages: [],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
      mergeIncoming: vi.fn(),
    });
    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[]}
        markReadAction={vi.fn()}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={sendAction}
        sendStatus="allowed"
      />,
    );
    const input = screen.getByRole("textbox", { name: "消息" });

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const firstForm = sendAction.mock.calls[0][1];
    await act(async () => finish({
      status: "temporarily_unavailable",
      message: "服务暂时不可用，请稍后重试。",
      clientMessageId: String(firstForm.get("clientMessageId")),
      attemptedBody: "first",
    }));
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeTruthy());
    const sendButton = await screen.findByRole("button", { name: "发送" });
    fireEvent.change(input, { target: { value: "second" } });
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton);
    const secondForm = sendAction.mock.calls[1][1];
    await act(async () => finish({
      status: "temporarily_unavailable",
      message: "服务暂时不可用，请稍后重试。",
      clientMessageId: String(secondForm.get("clientMessageId")),
      attemptedBody: "second",
    }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(2));
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("merges an Action result once before repeated synced copies arrive", async () => {
    const savedMessage: DirectMessage = {
      ...MESSAGE,
      id: "44",
      clientMessageId: CLIENT_MESSAGE_ID,
      senderId: "alice",
      senderDisplayName: "Alice",
      body: "saved once",
    };
    const mergeIncoming = vi.fn();
    const sendAction = vi.fn(async (
      _previousState: DirectMessageActionState,
      _formData: FormData,
    ): Promise<DirectMessageActionState> => {
      void _previousState;
      void _formData;
      return {
        status: "sent",
        message: "消息已发送。",
        clientMessageId: CLIENT_MESSAGE_ID,
        attemptedBody: savedMessage.body,
        savedMessage,
      };
    });
    const syncResult = {
      messages: [] as DirectMessage[],
      connected: true,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
      mergeIncoming,
    };
    sync.useDirectMessageSync.mockReturnValue(syncResult);
    const props = {
      clearAction: vi.fn(),
      conversationId: CONVERSATION_ID,
      currentUserId: "alice",
      initialHasOlderMessages: false,
      initialMessages: [] as DirectMessage[],
      markReadAction: vi.fn().mockResolvedValue("updated"),
      otherDisplayName: "Bob",
      reportAction: vi.fn(),
      sendAction,
      sendStatus: "allowed" as const,
    };
    const view = render(<ChatWorkspace {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "消息" }), {
      target: { value: savedMessage.body },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(mergeIncoming).toHaveBeenCalledWith([savedMessage]));
    expect(document.querySelector("[data-client-message-id]")).toBeNull();

    syncResult.messages = [savedMessage];
    view.rerender(<ChatWorkspace {...props} />);
    view.rerender(<ChatWorkspace {...props} />);
    expect(screen.getAllByText(savedMessage.body)).toHaveLength(1);
  });

  it("keeps history visible but disables sending for a removed friendship", () => {
    sync.useDirectMessageSync.mockReturnValue({
      messages: [MESSAGE],
      connected: false,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      backfill: vi.fn(),
      clearThrough: vi.fn(),
    });

    render(
      <ChatWorkspace
        clearAction={vi.fn()}
        conversationId={CONVERSATION_ID}
        currentUserId="alice"
        initialHasOlderMessages={false}
        initialMessages={[MESSAGE]}
        markReadAction={vi.fn().mockResolvedValue("updated")}
        otherDisplayName="Bob"
        reportAction={vi.fn()}
        sendAction={vi.fn()}
        sendStatus="readonly"
      />,
    );

    expect(screen.getByText("hello", { exact: false })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "消息" }) as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    // 只读可能来自好友关系结束，也可能来自双方当前不在同一学校（管理员跨校测试）
    expect(screen.getByText(/不允许发送新消息/)).toBeTruthy();
  });
});
