import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少服务端环境变量 ${name}。`);
  }
  return value;
}

export const serverEnv = {
  get emailOtpContextSecret() {
    return required(
      "EMAIL_OTP_CONTEXT_SECRET",
      process.env.EMAIL_OTP_CONTEXT_SECRET,
    );
  },
};
