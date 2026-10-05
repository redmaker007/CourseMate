import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: supabase.createClient }));

import { removePushSubscriptionAction, savePushSubscriptionAction } from "./actions";

const SUBSCRIPTION = {
  endpoint: "https://push.example/a",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

describe("push subscription actions", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.createClient.mockReset();
    supabase.createClient.mockResolvedValue({ rpc: supabase.rpc });
  });

  it("保存订阅时只把端点和密钥交给数据库函数", async () => {
    supabase.rpc.mockResolvedValue({ data: "saved", error: null });
    expect(await savePushSubscriptionAction(SUBSCRIPTION)).toEqual({ status: "saved" });
    expect(supabase.rpc).toHaveBeenCalledWith("save_push_subscription", {
      target_endpoint: SUBSCRIPTION.endpoint,
      target_p256dh: "p256dh-key",
      target_auth: "auth-key",
    });
  });

  it("数据库判定无效或出错时给出对应状态", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: "invalid", error: null });
    expect(await savePushSubscriptionAction(SUBSCRIPTION)).toEqual({ status: "invalid" });
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await savePushSubscriptionAction(SUBSCRIPTION)).toEqual({ status: "unavailable" });
    supabase.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await savePushSubscriptionAction(SUBSCRIPTION)).toEqual({ status: "unavailable" });
  });

  it("参数缺失时不访问数据库", async () => {
    expect(
      await savePushSubscriptionAction({ endpoint: "https://x", keys: undefined } as never),
    ).toEqual({ status: "invalid" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("取消订阅调用删除函数", async () => {
    supabase.rpc.mockResolvedValue({ data: "removed", error: null });
    expect(await removePushSubscriptionAction("https://push.example/a")).toEqual({
      status: "removed",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("remove_push_subscription", {
      target_endpoint: "https://push.example/a",
    });
  });
});
