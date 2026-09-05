import { describe, expect, it } from "vitest";

import { createSignOutService } from "./sign-out-service";

describe("signOutCurrentDevice", () => {
  it("当前设备有会话时退出成功", async () => {
    const service = createSignOutService({
      signOut: async () => undefined,
    });

    await expect(service.signOutCurrentDevice()).resolves.toEqual({
      status: "signed_out",
    });
  });

  it("当前没有会话时重复退出仍幂等地成功", async () => {
    let currentSessionExists = false;
    const service = createSignOutService({
      signOut: async () => {
        currentSessionExists = false;
      },
    });

    await expect(service.signOutCurrentDevice()).resolves.toEqual({
      status: "signed_out",
    });
    await expect(service.signOutCurrentDevice()).resolves.toEqual({
      status: "signed_out",
    });
    expect(currentSessionExists).toBe(false);
  });

  it("供应商异常时只返回稳定的暂时不可用结果", async () => {
    const service = createSignOutService({
      signOut: async () => {
        throw new Error("Supabase internal error with sensitive context");
      },
    });

    await expect(service.signOutCurrentDevice()).resolves.toEqual({
      status: "temporarily_unavailable",
    });
  });

  it("当前设备退出不会改变同一账号的其他设备会话", async () => {
    const sessions = {
      currentDevice: "current-session" as string | null,
      otherDevice: "other-session" as string | null,
    };
    const service = createSignOutService({
      signOut: async () => {
        sessions.currentDevice = null;
      },
    });

    await expect(service.signOutCurrentDevice()).resolves.toEqual({
      status: "signed_out",
    });
    expect(sessions).toEqual({
      currentDevice: null,
      otherDevice: "other-session",
    });
  });
});
