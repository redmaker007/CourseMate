import { expect, it, vi } from "vitest";
import { dispatchMobilePush, createPushDispatchHandler } from "./mobile-dispatch";
const job = { job_id: "11111111-1111-4111-8111-111111111111", lease: "22222222-2222-4222-8222-222222222222",
  device_token: "ab".repeat(32), recipient_id: "33333333-3333-4333-8333-333333333333",
  conversation_id: "44444444-4444-4444-8444-444444444444", sender_name: "同学" };
it("独立投递结果回写，网络失败恢复为重试；回写失败保留租约供恢复，绝不重新发送消息", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValueOnce({ data: "recorded", error: null });
  expect(await dispatchMobilePush(rpc, "sandbox", async () => "retry")).toMatchObject({ claimed: 1, retry: 1, unsettled: 0 });
  expect(rpc.mock.calls[1]).toEqual(["finish_mobile_push_job", { target_job: job.job_id, target_lease: job.lease, outcome: "retry" }]);
  rpc.mockReset().mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValueOnce({ data: null, error: { message: "synthetic" } });
  expect(await dispatchMobilePush(rpc, "sandbox", async () => "sent")).toMatchObject({ claimed: 1, unsettled: 1 });
  rpc.mockReset().mockResolvedValueOnce({ data: [{...job,device_token:"bad"}], error: null });
  const send = vi.fn();
  await expect(dispatchMobilePush(rpc,"sandbox",send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it("恢复入口只接受独立服务端秘密，用户 Bearer／Cookie 无权触发；无目标参数", async () => {
  const run = vi.fn().mockResolvedValue({ claimed: 0 });
  const handler = createPushDispatchHandler(() => "synthetic-dispatch-secret-at-least-32-characters", run);
  const request = (method: string, authorization?: string, body?: string) => new Request("https://app.example/api/mobile/v1/internal/push-dispatch", {
    method, headers: { ...(authorization ? { authorization } : {}), cookie: "synthetic-cookie" }, body,
  });
  expect((await handler(request("POST","Bearer synthetic-user-jwt"))).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
  const secret = "Bearer synthetic-dispatch-secret-at-least-32-characters";
  const response = await handler(request("POST",secret));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await handler(request("POST",secret,""))).status).toBe(200);
  expect((await handler(request("GET",secret))).status).toBe(405);
  expect((await handler(request("POST",secret,"{}"))).status).toBe(400);
  const off = createPushDispatchHandler(() => undefined, run);
  expect((await off(request("POST",secret))).status).toBe(503);
});
