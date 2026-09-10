import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const service = vi.hoisted(() => ({
  findMemberByEmail: vi.fn(),
  sendFriendRequest: vi.fn(),
  respondToFriendRequest: vi.fn(),
  setFriendNote: vi.fn(),
  setFriendHidden: vi.fn(),
  setMemberBlocked: vi.fn(),
  removeFriend: vi.fn(),
}));
const production = vi.hoisted(() => ({ createService: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/features/auth/session", () => auth);
vi.mock("./production-friendship-service", () => ({
  createProductionFriendshipService: production.createService,
}));

import {
  friendMutationAction,
  searchFriendAction,
} from "./actions";
import {
  initialFriendActionState,
  initialFriendSearchState,
} from "./friend-action-state";

const MEMBER = {
  userId: "11111111-1111-4111-8111-111111111111",
  schoolId: "uw-madison",
  email: "alice@wisc.edu",
  onboardingComplete: true,
};
const BOB = "22222222-2222-4222-8222-222222222222";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("friend Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue(MEMBER);
    production.createService.mockResolvedValue(service);
  });

  it("re-authenticates every entry point before creating the service", async () => {
    auth.getCurrentMember.mockResolvedValue(null);

    await expect(
      searchFriendAction(
        initialFriendSearchState,
        form({ email: "bob@wisc.edu" }),
      ),
    ).resolves.toMatchObject({ status: "unauthenticated" });
    await expect(
      friendMutationAction(
        initialFriendActionState,
        form({ intent: "hide", memberId: BOB }),
      ),
    ).resolves.toMatchObject({ status: "unauthenticated" });
    expect(production.createService).not.toHaveBeenCalled();
  });

  it("returns a discovery result without retaining the searched email", async () => {
    service.findMemberByEmail.mockResolvedValue({
      status: "found",
      member: {
        memberId: BOB,
        displayName: "Bob",
        avatarUrl: null,
        major: null,
        gradYear: null,
        sharedCourses: [{ id: "course-1", code: "CS 101", title: "Intro" }],
        relationship: "none",
        incomingRequestId: null,
      },
    });

    const result = await searchFriendAction(
      initialFriendSearchState,
      form({ email: "  bob@wisc.edu  " }),
    );

    expect(result).toMatchObject({
      status: "found",
      member: { memberId: BOB, displayName: "Bob" },
    });
    expect(JSON.stringify(result)).not.toContain("bob@wisc.edu");
    expect(service.findMemberByEmail).toHaveBeenCalledWith("  bob@wisc.edu  ");
  });

  it("maps a reverse pending request to an actionable safe message", async () => {
    service.sendFriendRequest.mockResolvedValue({
      status: "incoming_request",
      requestId: "33333333-3333-4333-8333-333333333333",
    });

    await expect(
      friendMutationAction(
        initialFriendActionState,
        form({ intent: "request", memberId: BOB, message: "你好" }),
      ),
    ).resolves.toMatchObject({
      status: "incoming_request",
      message: expect.stringContaining("对方已经申请你"),
    });
  });

  it("keeps backend validation effective when a request bypasses the UI", async () => {
    service.setFriendNote.mockResolvedValue({
      status: "invalid",
      fieldErrors: { note: "好友备注最多为 15 个字符。" },
    });

    await expect(
      friendMutationAction(
        initialFriendActionState,
        form({ intent: "note", memberId: BOB, note: "中".repeat(16) }),
      ),
    ).resolves.toEqual({
      status: "invalid",
      message: "请检查填写的内容。",
      fieldErrors: { note: "好友备注最多为 15 个字符。" },
    });
  });

  it("revalidates both friend views after a successful mutation", async () => {
    service.setFriendHidden.mockResolvedValue({ status: "saved" });

    await expect(
      friendMutationAction(
        initialFriendActionState,
        form({ intent: "hide", memberId: BOB }),
      ),
    ).resolves.toMatchObject({ status: "saved" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/friends");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/friends/filtered");
  });

  it("never serializes an internal service error to the client", async () => {
    production.createService.mockRejectedValue(
      new Error("private database connection detail"),
    );

    const result = await friendMutationAction(
      initialFriendActionState,
      form({ intent: "remove", memberId: BOB }),
    );

    expect(result).toMatchObject({ status: "temporarily_unavailable" });
    expect(JSON.stringify(result)).not.toContain("private database");
  });

  it("does not present a sanitized backend failure as a successful mutation", async () => {
    service.setFriendHidden.mockResolvedValue({
      status: "temporarily_unavailable",
    });

    await expect(
      friendMutationAction(
        initialFriendActionState,
        form({ intent: "hide", memberId: BOB }),
      ),
    ).resolves.toEqual({
      status: "temporarily_unavailable",
      message: "好友功能暂时不可用，请稍后重试。",
    });
  });
});
