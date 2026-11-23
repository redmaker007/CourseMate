import { describe, expect, it, vi } from "vitest";

import { createCourseOperations } from "@/features/courses/course-operations";
import { createFriendshipService, type FriendBackend } from "@/features/friends/friendship-service";
import { mobileMessageHttpStatus } from "@/features/messages/mobile-api";
import { sendSupabaseConversationMessage } from "@/features/messages/supabase-conversation-message";
import { createProfileService } from "@/features/profile/profile-service";

import { CONTENT_REJECTED_MESSAGE, contentRejectedField } from "./content-filter";

// PostgREST 把数据库异常的 detail 放在 details 字段。
const rejected = (field: string) => ({ code: "CM001", message: "content_rejected", details: field, hint: null });

describe("内容过滤错误识别", () => {
  it("只识别 CM001／content_rejected，并给出字段", () => {
    expect(contentRejectedField(rejected("major"))).toBe("major");
    expect(contentRejectedField({ code: "CM001", message: "content_rejected", detail: "message" })).toBe("message");
    expect(contentRejectedField({ code: "CM001", message: "content_rejected", details: "unexpected" })).toBe("body");
    expect(contentRejectedField({ code: "42501", message: "permission denied" })).toBeNull();
    expect(contentRejectedField(new Error("network"))).toBeNull();
    expect(contentRejectedField(null)).toBeNull();
  });
});

describe("各写入路径把过滤拒绝转成可修改的反馈", () => {
  it("消息发送返回 content_rejected，移动端映射为 422", async () => {
    const result = await sendSupabaseConversationMessage(
      { rpc: async () => ({ data: null, error: rejected("body") }) },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "text",
    );
    expect(result).toEqual({ status: "content_rejected" });
    expect(mobileMessageHttpStatus("content_rejected")).toBe(422);
    // 其他数据库错误仍按原逻辑抛出，由上层当作暂时不可用。
    await expect(sendSupabaseConversationMessage(
      { rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "text",
    )).rejects.toMatchObject({ code: "57014" });
  });

  it("课程发消息把 content_rejected 交给 Server Action", async () => {
    const operations = createCourseOperations({
      getCurrentMember: async () => ({ userId: "member-1", schoolId: "uw-madison", onboardingComplete: true }),
      getCourseCandidate: vi.fn(),
      getJoinedCourse: vi.fn(),
      joinOwnCourse: vi.fn(),
      leaveOwnCourse: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ status: "content_rejected" }),
    });
    await expect(operations.sendCourseMessage(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "text",
    )).resolves.toEqual({ status: "content_rejected" });
  });

  it("好友申请附言被拒时返回 invalid 和附言字段错误", async () => {
    const service = createFriendshipService({
      sendFriendRequest: vi.fn().mockRejectedValue(rejected("message")),
    } as unknown as FriendBackend);
    await expect(service.sendFriendRequest("22222222-2222-4222-8222-222222222222", "hi"))
      .resolves.toEqual({ status: "invalid", fieldErrors: { message: CONTENT_REJECTED_MESSAGE } });
  });

  it("资料保存被拒时指向对应字段，其他错误仍是暂时不可用", async () => {
    const save = vi.fn();
    const service = createProfileService({ getCurrentMember: async () => ({ userId: "member-1" }), saveOwnProfile: save });
    const draft = { displayName: "Bob", major: "Math", gradYear: "" };

    save.mockRejectedValueOnce(rejected("display_name"));
    await expect(service.saveProfile(draft))
      .resolves.toEqual({ status: "invalid", fieldErrors: { displayName: CONTENT_REJECTED_MESSAGE } });
    save.mockRejectedValueOnce(rejected("major"));
    await expect(service.saveProfile(draft))
      .resolves.toEqual({ status: "invalid", fieldErrors: { major: CONTENT_REJECTED_MESSAGE } });
    save.mockRejectedValueOnce(new Error("offline"));
    await expect(service.saveProfile(draft)).resolves.toEqual({ status: "temporarily_unavailable" });
  });
});
