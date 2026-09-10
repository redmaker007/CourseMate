import { describe, expect, it, vi } from "vitest";

import {
  createFriendshipService,
  type FriendBackend,
} from "./friendship-service";

function backend(overrides: Partial<FriendBackend> = {}): FriendBackend {
  return {
    findMemberByEmail: vi.fn().mockResolvedValue({ status: "not_found" }),
    sendFriendRequest: vi.fn(),
    respondToFriendRequest: vi.fn(),
    setFriendNote: vi.fn(),
    setFriendHidden: vi.fn(),
    setMemberBlocked: vi.fn(),
    removeFriend: vi.fn(),
    listFriends: vi.fn().mockResolvedValue([]),
    listFriendRequests: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("friendship service", () => {
  it("normalizes an exact email and returns only the public discovery view", async () => {
    const findMemberByEmail = vi.fn().mockResolvedValue({
      status: "found" as const,
      member: {
        memberId: "22222222-2222-4222-8222-222222222222",
        displayName: "Bob",
        avatarUrl: null,
        major: null,
        gradYear: null,
        sharedCourses: [{ id: "course-1", code: "CS101", title: "Intro" }],
        relationship: "none" as const,
        incomingRequestId: null,
      },
    });
    const service = createFriendshipService(backend({ findMemberByEmail }));

    const result = await service.findMemberByEmail("  BOB@EXAMPLE.EDU  ");

    expect(findMemberByEmail).toHaveBeenCalledWith("bob@example.edu");
    expect(result).toEqual({
      status: "found",
      member: {
        memberId: "22222222-2222-4222-8222-222222222222",
        displayName: "Bob",
        avatarUrl: null,
        major: null,
        gradYear: null,
        sharedCourses: [{ id: "course-1", code: "CS101", title: "Intro" }],
        relationship: "none",
        incomingRequestId: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("bob@example.edu");
  });

  it("accepts a 300-character request message and rejects 301 before the backend", async () => {
    const sendFriendRequest = vi.fn().mockResolvedValue({ status: "sent" });
    const service = createFriendshipService(backend({ sendFriendRequest }));
    const targetMemberId = "22222222-2222-4222-8222-222222222222";

    await expect(
      service.sendFriendRequest(targetMemberId, `  ${"中".repeat(300)}  `),
    ).resolves.toEqual({ status: "sent" });
    await expect(
      service.sendFriendRequest(targetMemberId, "中".repeat(301)),
    ).resolves.toEqual({
      status: "invalid",
      fieldErrors: { message: "好友申请附言必须为 1–300 个字符。" },
    });
    expect(sendFriendRequest).toHaveBeenCalledTimes(1);
    expect(sendFriendRequest).toHaveBeenCalledWith(
      targetMemberId,
      "中".repeat(300),
    );
  });

  it("normalizes, clears, and enforces the 15-character friend note boundary", async () => {
    const setFriendNote = vi.fn().mockResolvedValue({ status: "saved" });
    const service = createFriendshipService(backend({ setFriendNote }));
    const targetMemberId = "22222222-2222-4222-8222-222222222222";

    await expect(
      service.setFriendNote(targetMemberId, `  ${"中".repeat(15)}  `),
    ).resolves.toEqual({ status: "saved" });
    await expect(service.setFriendNote(targetMemberId, "   ")).resolves.toEqual({
      status: "saved",
    });
    await expect(
      service.setFriendNote(targetMemberId, "中".repeat(16)),
    ).resolves.toEqual({
      status: "invalid",
      fieldErrors: { note: "好友备注最多为 15 个字符。" },
    });
    expect(setFriendNote).toHaveBeenNthCalledWith(
      1,
      targetMemberId,
      "中".repeat(15),
    );
    expect(setFriendNote).toHaveBeenNthCalledWith(2, targetMemberId, null);
    expect(setFriendNote).toHaveBeenCalledTimes(2);
  });

  it("exposes stable relationship operations without accepting an actor id", async () => {
    const respondToFriendRequest = vi.fn().mockResolvedValue({
      status: "accepted",
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const setFriendHidden = vi.fn().mockResolvedValue({ status: "saved" });
    const setMemberBlocked = vi.fn().mockResolvedValue({ status: "saved" });
    const removeFriend = vi.fn().mockResolvedValue({ status: "removed" });
    const service = createFriendshipService(
      backend({
        respondToFriendRequest,
        setFriendHidden,
        setMemberBlocked,
        removeFriend,
      }),
    );
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const targetMemberId = "22222222-2222-4222-8222-222222222222";

    await expect(
      service.respondToFriendRequest(requestId, "accept"),
    ).resolves.toEqual({
      status: "accepted",
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await expect(service.setFriendHidden(targetMemberId, true)).resolves.toEqual({
      status: "saved",
    });
    await expect(service.setMemberBlocked(targetMemberId, true)).resolves.toEqual({
      status: "saved",
    });
    await expect(service.removeFriend(targetMemberId)).resolves.toEqual({
      status: "removed",
    });
    expect(respondToFriendRequest).toHaveBeenCalledWith(requestId, "accept");
    expect(setFriendHidden).toHaveBeenCalledWith(targetMemberId, true);
    expect(setMemberBlocked).toHaveBeenCalledWith(targetMemberId, true);
    expect(removeFriend).toHaveBeenCalledWith(targetMemberId);
  });

  it("converts backend failures to a non-sensitive unavailable result", async () => {
    const service = createFriendshipService(
      backend({
        findMemberByEmail: vi.fn().mockRejectedValue(
          new Error("duplicate key value contains secret@example.edu"),
        ),
        removeFriend: vi.fn().mockRejectedValue(new Error("raw database error")),
      }),
    );

    await expect(service.findMemberByEmail("secret@example.edu")).resolves.toEqual({
      status: "temporarily_unavailable",
    });
    await expect(
      service.removeFriend("22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
  });

  it("rejects malformed email and identifiers before crossing the backend seam", async () => {
    const candidate = backend();
    const service = createFriendshipService(candidate);

    await expect(service.findMemberByEmail("not an email")).resolves.toEqual({
      status: "invalid",
    });
    await expect(service.sendFriendRequest("forged", "hello")).resolves.toEqual({
      status: "invalid_target",
    });
    await expect(
      service.respondToFriendRequest("forged", "accept"),
    ).resolves.toEqual({ status: "invalid_request" });
    expect(candidate.findMemberByEmail).not.toHaveBeenCalled();
    expect(candidate.sendFriendRequest).not.toHaveBeenCalled();
    expect(candidate.respondToFriendRequest).not.toHaveBeenCalled();
  });
});
