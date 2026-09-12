// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let insertCallback: (() => void) | undefined;
let statusCallback: ((status: string) => void) | undefined;
const channel = {
  on: vi.fn((_event, _filter, callback: () => void) => {
    insertCallback = callback;
    return channel;
  }),
  subscribe: vi.fn((callback: (status: string) => void) => {
    statusCallback = callback;
    return channel;
  }),
};
const supabase = {
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabase }));
vi.mock("../actions", () => ({
  sendCourseMessageAction: vi.fn(),
}));

import { sendCourseMessageAction } from "../actions";
import type { CourseMessageActionState } from "../course-action-state";
import { CourseChat } from "./course-chat";

const COURSE_ID = "13000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const INITIAL = [
  {
    id: "1",
    senderId: "member-2",
    senderName: "Bob",
    body: "first",
    createdAt: "2026-09-10T00:00:00Z",
  },
];

describe("CourseChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCallback = undefined;
    statusCallback = undefined;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("crypto", { randomUUID: () => CLIENT_MESSAGE_ID });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("backfills and deduplicates after a Realtime insert signal", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: "2",
              senderId: "member-1",
              senderName: "Alice",
              body: "second",
              createdAt: "2026-09-10T00:01:00Z",
            },
          ],
          hasMore: true,
        }),
      } as Response)
      .mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "3",
            senderId: "member-1",
            senderName: "Alice",
            body: "third",
            createdAt: "2026-09-10T00:02:00Z",
          },
        ],
        hasMore: false,
      }),
    } as Response);

    render(
      <CourseChat
        archived={false}
        conversationId="conversation-1"
        courseId="course-1"
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );
    await act(async () => statusCallback?.("SUBSCRIBED"));
    await waitFor(() => expect(screen.getByText("second")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("third")).toBeTruthy());

    await act(async () => insertCallback?.());
    await waitFor(() => expect(screen.getAllByText("first")).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/courses/course-1/messages?after=1",
      { cache: "no-store" },
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/courses/course-1/messages?after=2",
      { cache: "no-store" },
    );
  });

  it("polls after five seconds while disconnected and backs off after failures", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(
      <CourseChat
        archived={false}
        conversationId="conversation-1"
        courseId="course-1"
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("backfills when the page regains focus", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], hasMore: false }),
    } as Response);
    render(
      <CourseChat
        archived={false}
        conversationId="conversation-1"
        courseId="course-1"
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("does not poll when mounted in a hidden tab", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], hasMore: false }),
    } as Response);
    render(
      <CourseChat
        archived={false}
        conversationId="conversation-1"
        courseId="course-1"
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a pending message immediately and retries a failure with the same id", async () => {
    let finish!: (state: {
      status: "unavailable";
      message: string;
      clientMessageId: string;
      attemptedBody: string;
    }) => void;
    vi.mocked(sendCourseMessageAction).mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    render(
      <CourseChat
        archived={false}
        conversationId={CONVERSATION_ID}
        courseId={COURSE_ID}
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );

    const input = screen.getByLabelText("消息内容");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      const pending = document.querySelector(
        "[data-client-message-id]",
      );
      expect(pending?.textContent).toContain("hello");
      expect(pending?.textContent).toContain("发送中");
    });
    const firstForm = vi.mocked(sendCourseMessageAction).mock.calls[0][1];
    const generatedId = String(firstForm.get("clientMessageId"));
    expect(generatedId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => {
      finish({
        status: "unavailable",
        message: "消息暂时无法发送。",
        clientMessageId: generatedId,
        attemptedBody: "hello",
      });
    });
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(sendCourseMessageAction).toHaveBeenCalledTimes(2),
    );
    const retryForm = vi.mocked(sendCourseMessageAction).mock.calls[1][1];
    expect(retryForm.get("clientMessageId")).toBe(generatedId);
    expect(retryForm.get("body")).toBe("hello");
  });

  it("hides the pending copy when Realtime returns the saved message first", async () => {
    let finish!: (state: CourseMessageActionState) => void;
    vi.mocked(sendCourseMessageAction).mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    render(
      <CourseChat
        archived={false}
        conversationId={CONVERSATION_ID}
        courseId={COURSE_ID}
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );
    const input = screen.getByLabelText("消息内容");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(document.querySelector(
        "[data-client-message-id]",
      )?.textContent).toContain("发送中"),
    );
    const sentForm = vi.mocked(sendCourseMessageAction).mock.calls[0][1];
    const generatedId = String(sentForm.get("clientMessageId"));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{
          id: "2",
          clientMessageId: generatedId,
          senderId: "member-1",
          senderName: "Alice",
          body: "hello",
          createdAt: "2026-09-12T00:00:00Z",
        }],
        hasMore: false,
      }),
    } as Response);

    await act(async () => insertCallback?.());
    await waitFor(() => expect(screen.getAllByText("hello")).toHaveLength(1));
    expect(document.querySelector(
      "[data-client-message-id]",
    )).toBeNull();
    await act(async () => insertCallback?.());
    expect(screen.getAllByText("hello")).toHaveLength(1);
    await act(async () => finish({
      status: "sent",
      message: "消息已发送。",
      clientMessageId: generatedId,
      attemptedBody: "hello",
      savedMessage: {
        id: "2",
        clientMessageId: generatedId,
        senderId: "member-1",
        senderName: "Alice",
        body: "hello",
        createdAt: "2026-09-12T00:00:00Z",
      },
    }));
    expect(screen.getAllByText("hello")).toHaveLength(1);
  });

  it("renders archived history without a send form", () => {
    render(
      <CourseChat
        archived
        conversationId="conversation-1"
        courseId="course-1"
        currentUserId="member-1"
        hasOlderMessages={false}
        initialMessages={INITIAL}
      />,
    );

    expect(screen.getByText("课程已归档，聊天记录仅供查看。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
  });
});
