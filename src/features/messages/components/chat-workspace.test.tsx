// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectMessage } from "../direct-message-service";

const sync = vi.hoisted(() => ({ useDirectMessageSync: vi.fn() }));
vi.mock("../use-direct-message-sync", () => sync);

import { ChatWorkspace } from "./chat-workspace";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MESSAGE: DirectMessage = {
  id: "42",
  conversationId: CONVERSATION_ID,
  senderId: "bob",
  senderDisplayName: "Bob",
  body: "hello https://example.com",
  createdAt: "2026-09-11T00:00:00Z",
};
const NEXT_MESSAGE: DirectMessage = { ...MESSAGE, id: "43", body: "next" };

afterEach(cleanup);

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
    expect(screen.getByText(/已不是好友/)).toBeTruthy();
  });
});
