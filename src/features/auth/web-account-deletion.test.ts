import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const api = vi.hoisted(() => ({ handleMobileDeletionRequest: vi.fn() }));
vi.mock("./account-deletion-api", () => api);

import { confirmWebDeletion, requestWebDeletionCode } from "./web-account-deletion";

const deps = { createClient: vi.fn() } as never;
const tokens = { challengeToken: "challenge", receiptToken: "r".repeat(43) };

describe("网页永久注销", () => {
  it("发码复用移动端同一流程，并把确认令牌交给表单", async () => {
    api.handleMobileDeletionRequest.mockResolvedValueOnce({ status: "code_sent", ...tokens, expiresAt: 1 });
    const state = await requestWebDeletionCode("access", deps);
    expect(api.handleMobileDeletionRequest).toHaveBeenLastCalledWith(
      expect.any(Request), "account/deletion/challenge", {}, "access", deps,
    );
    expect(state).toEqual({ status: "code_sent", message: expect.stringContaining("验证码已发送"), ...tokens });
  });

  it("确认时只有勾选才发送 DELETE；验证码错误保留令牌以便重试", async () => {
    api.handleMobileDeletionRequest.mockResolvedValueOnce({ status: "invalid_or_expired_code" });
    const state = await confirmWebDeletion("access", { ...tokens, code: " 123456 ", confirmed: true }, deps);
    expect(api.handleMobileDeletionRequest).toHaveBeenLastCalledWith(
      expect.any(Request), "account/deletion",
      { ...tokens, code: "123456", confirmation: "DELETE" }, "access", deps,
    );
    expect(state).toMatchObject({ status: "invalid_or_expired_code", ...tokens });

    api.handleMobileDeletionRequest.mockResolvedValueOnce({ status: "invalid_request" });
    await confirmWebDeletion("access", { ...tokens, code: "123456", confirmed: false }, deps);
    expect(api.handleMobileDeletionRequest.mock.lastCall?.[2]).toMatchObject({ confirmation: "" });
  });

  it("确认过期或身份变化时清掉令牌；异常按暂时不可用处理且保留令牌", async () => {
    api.handleMobileDeletionRequest.mockResolvedValueOnce({ status: "invalid_challenge" });
    expect(await confirmWebDeletion("access", { ...tokens, code: "123456", confirmed: true }, deps))
      .toEqual({ status: "invalid_challenge", message: expect.any(String) });

    api.handleMobileDeletionRequest.mockRejectedValueOnce(new Error("network"));
    expect(await confirmWebDeletion("access", { ...tokens, code: "123456", confirmed: true }, deps))
      .toMatchObject({ status: "temporarily_unavailable", ...tokens });

    api.handleMobileDeletionRequest.mockResolvedValueOnce({ status: "completed" });
    expect(await confirmWebDeletion("access", { ...tokens, code: "123456", confirmed: true }, deps))
      .toEqual({ status: "completed", message: "账号已永久注销。" });
  });
});
