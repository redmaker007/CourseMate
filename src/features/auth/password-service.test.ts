import { describe, expect, it, vi } from "vitest";

import {
  createPasswordSetupService,
  createPasswordSignInService,
  isAcceptablePassword,
  type MemberAccessStatus,
  type PasswordSetupPort,
} from "./password-service";

const MEMBER = { userId: "user-1", email: "student@wisc.edu" };

function signIn({
  auth = "signed_in" as const,
  access = ["none", "member"] as MemberAccessStatus[],
} = {}) {
  const discardSession = vi.fn(async () => {});
  const signInPort = vi.fn(async () => ({ status: auth }));
  const readAccess = vi.fn(async () => access.shift() ?? "none");
  const service = createPasswordSignInService({ auth: { signIn: signInPort, discardSession }, readAccess });
  return { service, signInPort, discardSession };
}

describe("密码规则", () => {
  it("至少 8 个字符，最多 72 字节", () => {
    expect(isAcceptablePassword("1234567")).toBe(false);
    expect(isAcceptablePassword("12345678")).toBe(true);
    expect(isAcceptablePassword("a".repeat(72))).toBe(true);
    expect(isAcceptablePassword("a".repeat(73))).toBe(false);
    // 中文每字 3 字节：24 字刚好 72 字节。
    expect(isAcceptablePassword("密".repeat(24))).toBe(true);
    expect(isAcceptablePassword("密".repeat(25))).toBe(false);
  });
});

describe("密码登录", () => {
  it("邮箱规范化后登录，成员有效才算成功", async () => {
    const { service, signInPort, discardSession } = signIn();
    await expect(service.signIn(" Student@WISC.EDU ", "secret-123")).resolves.toEqual({ status: "signed_in" });
    expect(signInPort).toHaveBeenCalledWith("Student@wisc.edu", "secret-123");
    expect(discardSession).not.toHaveBeenCalled();
  });

  it("已经是有效成员时不再登录", async () => {
    const { service, signInPort } = signIn({ access: ["member"] });
    await expect(service.signIn(MEMBER.email, "secret-123")).resolves.toEqual({ status: "already_signed_in" });
    expect(signInPort).not.toHaveBeenCalled();
  });

  it("需要重新验证时丢掉刚建的会话，提示用验证码", async () => {
    const { service, discardSession } = signIn({ access: ["none", "reverification_required"] });
    await expect(service.signIn(MEMBER.email, "secret-123")).resolves.toEqual({ status: "reverification_required" });
    expect(discardSession).toHaveBeenCalledOnce();
  });

  it("密码对了但不是可用成员时丢掉会话，结果与密码错误相同", async () => {
    const { service, discardSession } = signIn({ access: ["none", "none"] });
    await expect(service.signIn(MEMBER.email, "secret-123")).resolves.toEqual({ status: "invalid_credentials" });
    expect(discardSession).toHaveBeenCalledOnce();
  });

  it("格式不对、空密码或超长密码不调用 Auth，统一为密码错误", async () => {
    for (const [email, password] of [["not-an-email", "secret-123"], [MEMBER.email, ""], [MEMBER.email, "a".repeat(73)]]) {
      const { service, signInPort } = signIn();
      await expect(service.signIn(email, password)).resolves.toEqual({ status: "invalid_credentials" });
      expect(signInPort).not.toHaveBeenCalled();
    }
  });

  it("Auth 限流和故障原样区分", async () => {
    await expect(signIn({ auth: "rate_limited" as never }).service.signIn(MEMBER.email, "secret-123")).resolves.toEqual({ status: "rate_limited" });
    await expect(signIn({ auth: "unavailable" as never }).service.signIn(MEMBER.email, "secret-123")).resolves.toEqual({ status: "temporarily_unavailable" });
  });
});

describe("设置密码", () => {
  function setup(result: Awaited<ReturnType<PasswordSetupPort["setPassword"]>>["status"] = "password_set") {
    const port = {
      requestCode: vi.fn(async () => ({ status: "accepted" as const })),
      setPassword: vi.fn(async () => ({ status: result })),
    };
    return { port, service: createPasswordSetupService(port) };
  }

  it("验证码只发给当前会话的邮箱", async () => {
    const { port, service } = setup();
    await expect(service.requestCode(MEMBER)).resolves.toEqual({ status: "code_sent", email: MEMBER.email });
    expect(port.requestCode).toHaveBeenCalledWith(MEMBER.email);
  });

  it("用当前会话的身份验码改密码", async () => {
    const { port, service } = setup();
    await expect(
      service.setPassword(MEMBER, { contextEmail: MEMBER.email, code: " 123456 ", password: "secret-123" }),
    ).resolves.toEqual({ status: "password_set" });
    expect(port.setPassword).toHaveBeenCalledWith({
      email: MEMBER.email,
      code: "123456",
      password: "secret-123",
      expectedUserId: MEMBER.userId,
    });
  });

  it("上下文属于别的邮箱、验证码格式不对、密码太弱都在调用前拒绝", async () => {
    const { port, service } = setup();
    await expect(service.setPassword(MEMBER, { contextEmail: "other@wisc.edu", code: "123456", password: "secret-123" })).resolves.toEqual({ status: "invalid_context" });
    await expect(service.setPassword(MEMBER, { contextEmail: MEMBER.email, code: "12345", password: "secret-123" })).resolves.toEqual({ status: "invalid_or_expired_code" });
    await expect(service.setPassword(MEMBER, { contextEmail: MEMBER.email, code: "123456", password: "short" })).resolves.toEqual({ status: "weak_password" });
    expect(port.setPassword).not.toHaveBeenCalled();
  });

  it("端口失败映射为稳定结果，抛错按暂时不可用", async () => {
    const input = { contextEmail: MEMBER.email, code: "123456", password: "secret-123" };
    await expect(setup("invalid_or_expired").service.setPassword(MEMBER, input)).resolves.toEqual({ status: "invalid_or_expired_code" });
    await expect(setup("unavailable").service.setPassword(MEMBER, input)).resolves.toEqual({ status: "temporarily_unavailable" });
    const { port, service } = setup();
    port.setPassword.mockRejectedValueOnce(new Error("network"));
    await expect(service.setPassword(MEMBER, input)).resolves.toEqual({ status: "temporarily_unavailable" });
  });
});
