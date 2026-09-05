import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseCurrentDeviceSession } from "./supabase-current-device-session";

describe("Supabase current device session", () => {
  it("退出只使用 Supabase 当前设备范围", async () => {
    let signOutInput: unknown;
    const adapter = createSupabaseCurrentDeviceSession({
      auth: {
        signOut: async (input: unknown) => {
          signOutInput = input;
          return { error: null };
        },
      },
    } as unknown as SupabaseClient);

    await expect(adapter.signOut()).resolves.toBeUndefined();
    expect(signOutInput).toEqual({ scope: "local" });
  });
});
