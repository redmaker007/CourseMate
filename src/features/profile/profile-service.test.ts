import { describe, expect, it, vi } from "vitest";

import { createProfileService } from "./profile-service";

describe("Profile service", () => {
  it("保存当前成员的规范化 Profile，而不是接受客户端用户 ID", async () => {
    const saveOwnProfile = vi.fn().mockResolvedValue(undefined);
    const service = createProfileService({
      getCurrentMember: async () => ({
        userId: "member-1",
      }),
      saveOwnProfile,
    });

    await expect(
      service.saveProfile({
        displayName: "  小明  ",
        major: "  Computer Science  ",
        gradYear: "2028",
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(saveOwnProfile).toHaveBeenCalledWith({
      userId: "member-1",
      displayName: "小明",
      major: "Computer Science",
      gradYear: 2028,
    });
  });

  it("接受 15 个中文字符并拒绝 16 个", async () => {
    const saveOwnProfile = vi.fn().mockResolvedValue(undefined);
    const service = createProfileService({
      getCurrentMember: async () => ({
        userId: "member-1",
      }),
      saveOwnProfile,
    });

    await expect(
      service.saveProfile({
        displayName: "一二三四五六七八九十一二三四五",
        major: "",
        gradYear: "",
      }),
    ).resolves.toEqual({ status: "saved" });
    await expect(
      service.saveProfile({
        displayName: "一二三四五六七八九十一二三四五六",
        major: "",
        gradYear: "",
      }),
    ).resolves.toEqual({
      status: "invalid",
      fieldErrors: { displayName: "显示名称最多 15 个字符。" },
    });
    expect(saveOwnProfile).toHaveBeenCalledTimes(1);
  });

  it("拒绝空名称、过长专业和无效毕业年份", async () => {
    const saveOwnProfile = vi.fn().mockResolvedValue(undefined);
    const service = createProfileService({
      getCurrentMember: async () => ({
        userId: "member-1",
      }),
      saveOwnProfile,
    });

    await expect(
      service.saveProfile({
        displayName: "   ",
        major: "x".repeat(81),
        gradYear: "2028.5",
      }),
    ).resolves.toEqual({
      status: "invalid",
      fieldErrors: {
        displayName: "请填写显示名称。",
        major: "专业最多 80 个字符。",
        gradYear: "请输入 2020–2040 之间的毕业年份。",
      },
    });
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("没有成员会话时拒绝保存", async () => {
    const saveOwnProfile = vi.fn();
    const service = createProfileService({
      getCurrentMember: async () => null,
      saveOwnProfile,
    });

    await expect(
      service.saveProfile({ displayName: "小明", major: "", gradYear: "" }),
    ).resolves.toEqual({ status: "unauthenticated" });
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("数据库失败时只返回受限的不可用状态", async () => {
    const service = createProfileService({
      getCurrentMember: async () => ({
        userId: "member-1",
      }),
      saveOwnProfile: async () => {
        throw new Error("private database detail");
      },
    });

    await expect(
      service.saveProfile({ displayName: "小明", major: "", gradYear: "" }),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
  });
});
