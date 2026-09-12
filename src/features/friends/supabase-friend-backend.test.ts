import { describe, expect, it, vi } from "vitest";

import { createSupabaseFriendBackend } from "./supabase-friend-backend";

describe("Supabase friend backend", () => {
  it("maps the restricted discovery RPC without returning the searched email", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          result_status: "found",
          member_id: "22222222-2222-4222-8222-222222222222",
          display_name: "Bob",
          avatar_url: null,
          major: null,
          grad_year: null,
          shared_courses: [{ id: "course-1", code: "CS101", title: "Intro" }],
          relationship_status: "none",
          block_status: "none",
          incoming_request_id: null,
        },
      ],
      error: null,
    });
    const backend = createSupabaseFriendBackend({ rpc });

    const result = await backend.findMemberByEmail("bob@example.edu");

    expect(rpc).toHaveBeenCalledWith("find_member_by_email", {
      candidate_email: "bob@example.edu",
    });
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
        blockStatus: "none",
        incomingRequestId: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("bob@example.edu");
  });

  it("maps mutation statuses and throws database errors for service sanitization", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ result_status: "sent", request_id: "request-1" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "secret row" } });
    const backend = createSupabaseFriendBackend({ rpc });

    await expect(
      backend.sendFriendRequest(
        "22222222-2222-4222-8222-222222222222",
        "hello",
      ),
    ).resolves.toEqual({ status: "sent", requestId: "request-1" });
    await expect(
      backend.removeFriend("22222222-2222-4222-8222-222222222222"),
    ).rejects.toEqual({ message: "secret row" });
  });

  it("maps the current member's private blocked-member list", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          member_id: "22222222-2222-4222-8222-222222222222",
          display_name: "Bob",
          avatar_url: null,
          active_friendship: false,
          conversation_id: null,
        },
      ],
      error: null,
    });
    const backend = createSupabaseFriendBackend({ rpc });

    await expect(backend.listBlockedMembers()).resolves.toEqual([
      {
        memberId: "22222222-2222-4222-8222-222222222222",
        displayName: "Bob",
        avatarUrl: null,
        activeFriendship: false,
        conversationId: null,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_blocked_members", {});
  });

  it("maps each block direction for the friend list", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ["blocked_by_me", "blocked_by_other", "mutual"].map(
        (block_status, index) => ({
          member_id: `00000000-0000-4000-8000-00000000000${index}`,
          display_name: `Member ${index}`,
          effective_name: `Member ${index}`,
          avatar_url: null,
          major: null,
          grad_year: null,
          shared_courses: [],
          hidden: false,
          send_status: "blocked",
          block_status,
          conversation_id: `10000000-0000-4000-8000-00000000000${index}`,
        }),
      ),
      error: null,
    });
    const backend = createSupabaseFriendBackend({ rpc });

    const friends = await backend.listFriends(false);

    expect(friends.map((friend) => friend.blockStatus)).toEqual([
      "blocked_by_me",
      "blocked_by_other",
      "mutual",
    ]);
  });
});
