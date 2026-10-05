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
  /**
   * 网页推送配置。四项缺任何一项都返回 null，推送整体关闭（发送器不动作、资料页不显示开关），
   * 所以代码可以先于密钥发布。SUPABASE_SERVICE_ROLE_KEY 绕过 RLS，只能在 server-only 代码里用，
   * 且只用来调用 claim_push_targets_* / drop_push_subscription 这几个受限函数。
   */
  get push() {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!serviceRoleKey || !publicKey || !privateKey || !subject) return null;
    return { serviceRoleKey, publicKey, privateKey, subject };
  },
};
