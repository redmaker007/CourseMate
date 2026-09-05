import { describe, expect, it } from "vitest";

import {
  createEmailOtpService,
  type AuthCodeRequestResult,
  type AuthCodeVerificationResult,
  type EmailCodeRequestResult,
  type EmailCodeVerificationResult,
} from "./email-otp-service";
import { FakeEmailOtpAuth } from "./testing/fake-email-otp-auth";

describe("requestEmailCode", () => {
  it("开放学校的精确邮箱域名可以请求验证码", async () => {
    const auth = new FakeEmailOtpAuth();
    const service = createEmailOtpService({
      auth,
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async (schoolId, domain) =>
          schoolId === "uw-madison" && domain === "wisc.edu",
      },
    });

    await expect(
      service.requestEmailCode("uw-madison", "student@wisc.edu"),
    ).resolves.toEqual({
      status: "code_sent",
      schoolId: "uw-madison",
      email: "student@wisc.edu",
    });
    expect(auth.requestedEmails).toEqual(["student@wisc.edu"]);
  });

  it("只规范化整段空格和域名并保留邮箱本地部分", async () => {
    let requestedEmail = "";
    const service = createEmailOtpService({
      auth: {
        requestCode: async (email) => {
          requestedEmail = email;
          return { status: "accepted" };
        },
        verifyCode: async () => ({ status: "verified" }),
      },
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async (_schoolId, domain) =>
          domain === "wisc.edu",
      },
    });

    const result = await service.requestEmailCode(
      "uw-madison",
      "  Student.Name+Course@WISC.EDU  ",
    );

    expect(result).toEqual({
      status: "code_sent",
      schoolId: "uw-madison",
      email: "Student.Name+Course@wisc.edu",
    });
    expect(requestedEmail).toBe("Student.Name+Course@wisc.edu");
  });

  it.each([
    ["缺少邮箱", "uw-madison", ""],
    ["缺少 @", "uw-madison", "student.wisc.edu"],
    ["包含多个 @", "uw-madison", "student@extra@wisc.edu"],
    ["缺少本地部分", "uw-madison", "@wisc.edu"],
    ["包含内部空格", "uw-madison", "student name@wisc.edu"],
    ["本地部分以点开头", "uw-madison", ".student@wisc.edu"],
    ["本地部分以点结尾", "uw-madison", "student.@wisc.edu"],
    ["本地部分包含连续点", "uw-madison", "student..name@wisc.edu"],
    ["本地部分包含非常用字符", "uw-madison", "学生@wisc.edu"],
    ["本地部分超过 64 字符", "uw-madison", `${"a".repeat(65)}@wisc.edu`],
    ["任意其他 .edu", "uw-madison", "student@umich.edu"],
    ["未配置子域名", "uw-madison", "student@cs.wisc.edu"],
    ["未选择学校", "", "student@wisc.edu"],
  ])("%s 时拒绝且不请求发送", async (_caseName, schoolId, email) => {
    let authWasCalled = false;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => {
          authWasCalled = true;
          return { status: "accepted" };
        },
        verifyCode: async () => ({ status: "verified" }),
      },
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async (candidateSchoolId, domain) =>
          candidateSchoolId === "uw-madison" && domain === "wisc.edu",
      },
    });

    await expect(service.requestEmailCode(schoolId, email)).resolves.toEqual({
      status: "invalid_email",
    });
    expect(authWasCalled).toBe(false);
  });

  it("已有有效成员会话时不再发送验证码", async () => {
    let authWasCalled = false;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => {
          authWasCalled = true;
          return { status: "accepted" };
        },
        verifyCode: async () => ({ status: "verified" }),
      },
      memberSession: {
        hasValidMemberSession: async () => true,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.requestEmailCode("uw-madison", "student@wisc.edu"),
    ).resolves.toEqual({ status: "already_signed_in" });
    expect(authWasCalled).toBe(false);
  });

  it.each<
    [AuthCodeRequestResult["status"], EmailCodeRequestResult["status"]]
  >([
    ["accepted", "code_sent"],
    ["rate_limited", "rate_limited"],
    ["delivery_failed", "send_failed"],
    ["unavailable", "temporarily_unavailable"],
  ])("将 Auth 的 %s 映射为 %s", async (authStatus, expectedStatus) => {
    const auth = new FakeEmailOtpAuth();
    auth.nextResult = { status: authStatus };
    const service = createEmailOtpService({
      auth,
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    const result = await service.requestEmailCode(
      "uw-madison",
      "student@wisc.edu",
    );

    expect(result.status).toBe(expectedStatus);
  });

  it.each(["memberSession", "schools", "auth"] as const)(
    "%s 边界异常时只返回暂时不可用",
    async (failingBoundary) => {
      const failure = new Error("包含供应商内部信息的错误");
      const service = createEmailOtpService({
        auth: {
          requestCode: async () => {
            if (failingBoundary === "auth") throw failure;
            return { status: "accepted" };
          },
          verifyCode: async () => ({ status: "verified" }),
        },
        memberSession: {
          hasValidMemberSession: async () => {
            if (failingBoundary === "memberSession") throw failure;
            return false;
          },
        },
        schools: {
          matchesEnabledSchool: async () => {
            if (failingBoundary === "schools") throw failure;
            return true;
          },
        },
      });

      await expect(
        service.requestEmailCode("uw-madison", "student@wisc.edu"),
      ).resolves.toEqual({ status: "temporarily_unavailable" });
    },
  );
});

describe("verifyEmailCode", () => {
  it("验证码正确且成员账号已自动绑定时登录成功", async () => {
    let sessionCheckCount = 0;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => ({ status: "accepted" }),
        verifyCode: async () => ({ status: "verified" }),
      },
      memberSession: {
        hasValidMemberSession: async () => {
          sessionCheckCount += 1;
          return sessionCheckCount === 2;
        },
      },
      schools: {
        matchesEnabledSchool: async (schoolId, domain) =>
          schoolId === "uw-madison" && domain === "wisc.edu",
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "123456",
      ),
    ).resolves.toEqual({ status: "signed_in" });
  });

  it.each(["12345", "1234567", "12 3456", "12345a", "１２３４５６"])(
    "验证码 %s 格式无效时不调用 Supabase",
    async (code) => {
      let authWasCalled = false;
      const service = createEmailOtpService({
        auth: {
          requestCode: async () => ({ status: "accepted" }),
          verifyCode: async () => {
            authWasCalled = true;
            return { status: "verified" };
          },
        },
        memberSession: {
          hasValidMemberSession: async () => false,
        },
        schools: {
          matchesEnabledSchool: async () => true,
        },
      });

      await expect(
        service.verifyEmailCode("uw-madison", "student@wisc.edu", code),
      ).resolves.toEqual({ status: "invalid_or_expired_code" });
      expect(authWasCalled).toBe(false);
    },
  );

  it("验证码首尾空格被清除后再交给 Supabase", async () => {
    let verifiedCode = "";
    let sessionCheckCount = 0;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => ({ status: "accepted" }),
        verifyCode: async (_email, code) => {
          verifiedCode = code;
          return { status: "verified" };
        },
      },
      memberSession: {
        hasValidMemberSession: async () => ++sessionCheckCount === 2,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "  123456  ",
      ),
    ).resolves.toEqual({ status: "signed_in" });
    expect(verifiedCode).toBe("123456");
  });

  it("已有有效成员会话时不再验证验证码", async () => {
    let authWasCalled = false;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => ({ status: "accepted" }),
        verifyCode: async () => {
          authWasCalled = true;
          return { status: "verified" };
        },
      },
      memberSession: {
        hasValidMemberSession: async () => true,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "123456",
      ),
    ).resolves.toEqual({ status: "already_signed_in" });
    expect(authWasCalled).toBe(false);
  });

  it.each([
    ["学校不匹配", "umich", "student@wisc.edu"],
    ["其他域名", "uw-madison", "student@umich.edu"],
    ["未配置子域名", "uw-madison", "student@cs.wisc.edu"],
    ["邮箱格式错误", "uw-madison", "student@@wisc.edu"],
  ])("%s 时不验证验证码", async (_caseName, schoolId, email) => {
    let authWasCalled = false;
    const service = createEmailOtpService({
      auth: {
        requestCode: async () => ({ status: "accepted" }),
        verifyCode: async () => {
          authWasCalled = true;
          return { status: "verified" };
        },
      },
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async (candidateSchoolId, domain) =>
          candidateSchoolId === "uw-madison" && domain === "wisc.edu",
      },
    });

    await expect(
      service.verifyEmailCode(schoolId, email, "123456"),
    ).resolves.toEqual({ status: "invalid_email" });
    expect(authWasCalled).toBe(false);
  });

  it.each<
    [
      AuthCodeVerificationResult["status"],
      EmailCodeVerificationResult["status"],
    ]
  >([
    ["invalid_or_expired", "invalid_or_expired_code"],
    ["rate_limited", "rate_limited"],
    ["unavailable", "temporarily_unavailable"],
  ])("将验证码验证的 %s 映射为 %s", async (authStatus, expectedStatus) => {
    const auth = new FakeEmailOtpAuth();
    auth.nextVerificationResult = { status: authStatus };
    const service = createEmailOtpService({
      auth,
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "123456",
      ),
    ).resolves.toEqual({ status: expectedStatus });
  });

  it("Supabase 验证成功但成员绑定缺失时不算登录成功", async () => {
    const auth = new FakeEmailOtpAuth();
    const service = createEmailOtpService({
      auth,
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "123456",
      ),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
  });

  it("验证边界抛出内部错误时只返回稳定的暂时不可用结果", async () => {
    const auth = new FakeEmailOtpAuth();
    auth.nextError = new Error("供应商内部错误和敏感上下文");
    const service = createEmailOtpService({
      auth,
      memberSession: {
        hasValidMemberSession: async () => false,
      },
      schools: {
        matchesEnabledSchool: async () => true,
      },
    });

    await expect(
      service.verifyEmailCode(
        "uw-madison",
        "student@wisc.edu",
        "123456",
      ),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
    expect(auth.verificationAttempts).toEqual([
      { email: "student@wisc.edu", code: "123456" },
    ]);
  });
});
