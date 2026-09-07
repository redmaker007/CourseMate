import { describe, expect, it } from "vitest";

import { createMemberSessionReader } from "./member-session";

describe("getMemberSession", () => {
  it("Supabase 用户与学校绑定一致时返回完整成员会话", async () => {
    const reader = createMemberSessionReader({
      getVerifiedUser: async () => ({
        id: "user-1",
        email: "Student@WISC.EDU",
      }),
      getMemberBinding: async () => ({
        userId: "user-1",
        schoolId: "uw-madison",
      }),
      getEnabledSchoolIdForDomain: async () => "uw-madison",
    });

    await expect(reader.getMemberSession()).resolves.toEqual({
      userId: "user-1",
      schoolId: "uw-madison",
    });
  });

  it("只有 Supabase 会话但没有 Member Account 时返回未登录", async () => {
    const reader = createMemberSessionReader({
      getVerifiedUser: async () => ({
        id: "auth-only-user",
        email: "student@wisc.edu",
      }),
      getMemberBinding: async () => null,
      getEnabledSchoolIdForDomain: async () => "uw-madison",
    });

    await expect(reader.getMemberSession()).resolves.toBeNull();
  });

  it("Supabase 会话失效时返回未登录且不读取绑定", async () => {
    let bindingWasRead = false;
    const reader = createMemberSessionReader({
      getVerifiedUser: async () => null,
      getMemberBinding: async () => {
        bindingWasRead = true;
        return null;
      },
      getEnabledSchoolIdForDomain: async () => "uw-madison",
    });

    await expect(reader.getMemberSession()).resolves.toBeNull();
    expect(bindingWasRead).toBe(false);
  });

  it("邮箱学校与 Member Account 绑定不一致时返回未登录", async () => {
    const reader = createMemberSessionReader({
      getVerifiedUser: async () => ({
        id: "user-1",
        email: "student@wisc.edu",
      }),
      getMemberBinding: async () => ({
        userId: "user-1",
        schoolId: "other-school",
      }),
      getEnabledSchoolIdForDomain: async () => "uw-madison",
    });

    await expect(reader.getMemberSession()).resolves.toBeNull();
  });
});
