// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectMessage } from "./direct-message-service";

const realtime = vi.hoisted(() => {
  let statusHandler: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn((handler: (status: string) => void) => {
      statusHandler = handler;
      return channel;
    }),
  };
  channel.on.mockReturnValue(channel);
  return {
    channel,
    client: { channel: vi.fn(() => channel), removeChannel: vi.fn() },
    emit(status: string) {
      statusHandler?.(status);
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => realtime.client,
}));

import { useDirectMessageSync } from "./use-direct-message-sync";

const message = (id: string): DirectMessage => ({
  id,
  conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  senderDisplayName: "Bob",
  body: `message-${id}`,
  createdAt: "2026-09-11T00:00:00Z",
});

function Harness() {
  const sync = useDirectMessageSync({
    conversationId: message("1").conversationId,
    initialMessages: [message("1")],
    initialHasOlderMessages: false,
  });
  return <div>{sync.connected ? "online" : "offline"}:{sync.messages.map((item) => item.id).join(",")}</div>;
}

describe("direct message sync hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [message("2")], hasMore: false }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("backfills on Realtime subscribe and merges by bigint message id", async () => {
    render(<Harness />);

    act(() => realtime.emit("SUBSCRIBED"));

    await waitFor(() => expect(screen.getByText("online:1,2")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("?after=1"),
      { cache: "no-store" },
    );
  });

  it("polls while disconnected and visible, then stops after reconnect", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => realtime.emit("CHANNEL_ERROR"));

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalled();
    const callsBeforeReconnect = vi.mocked(fetch).mock.calls.length;

    act(() => realtime.emit("SUBSCRIBED"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBeforeReconnect + 1);
  });
});
