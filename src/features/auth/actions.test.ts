import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialRequestEmailCodeState } from "./request-email-code-state";

const productionService = vi.hoisted(() => ({
  requestEmailCode: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server-env", () => ({
  serverEnv: {
    emailOtpContextSecret: "test-secret-with-at-least-32-characters",
  },
}));

vi.mock("./production-email-otp-service", () => ({
  createProductionEmailOtpService: async () => productionService,
}));

vi.mock("./production-sign-out-service", () => ({
  createProductionSignOutService: async () => ({
    signOutCurrentDevice: async () => ({ status: "signed_out" as const }),
  }),
}));

import { requestEmailCodeAction } from "./actions";

describe("requestEmailCodeAction 日志", () => {
  beforeEach(() => {
    productionService.requestEmailCode.mockReset();
    vi.restoreAllMocks();
  });

  it("不会把客户端提供的 schoolId 原样写入日志", async () => {
    const untrustedSchoolId =
      "student@wisc.edu otp=123456 credential=should-not-be-logged";
    productionService.requestEmailCode.mockResolvedValue({
      status: "invalid_email",
    });
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const formData = new FormData();
    formData.set("schoolId", untrustedSchoolId);
    formData.set("email", "student@wisc.edu");

    await requestEmailCodeAction(initialRequestEmailCodeState, formData);

    const loggedOutput = consoleInfo.mock.calls.flat().join(" ");
    expect(loggedOutput).not.toContain(untrustedSchoolId);
    expect(loggedOutput).not.toContain("student@wisc.edu");
    expect(loggedOutput).not.toContain("123456");
    expect(loggedOutput).toContain('"schoolId":"unresolved"');
  });

  it("成功时只记录服务层确认后的标准学校 ID", async () => {
    productionService.requestEmailCode.mockResolvedValue({
      status: "code_sent",
      schoolId: "uw-madison",
      email: "student@wisc.edu",
    });
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const formData = new FormData();
    formData.set("schoolId", "untrusted-client-value");
    formData.set("email", "student@wisc.edu");

    await requestEmailCodeAction(initialRequestEmailCodeState, formData);

    const loggedOutput = consoleInfo.mock.calls.flat().join(" ");
    expect(loggedOutput).not.toContain("untrusted-client-value");
    expect(loggedOutput).not.toContain("student@wisc.edu");
    expect(loggedOutput).toContain('"schoolId":"uw-madison"');
  });
});
