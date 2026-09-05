/**
 * 集中读取并校验环境变量。
 *
 * 用 getter 惰性读取，而不是在模块加载时就校验——否则没有 .env.local 的机器上
 * `next build` 会直接崩掉。缺变量的错误留到真正用到它的请求时再抛。
 *
 * NEXT_PUBLIC_* 必须写成字面量 process.env.XXX，Next 才能在构建时把值内联进客户端包，
 * 所以这里不能用动态 key 去取。
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `缺少环境变量 ${name}。请复制 .env.example 为 .env.local 并填入 Supabase 项目信息。`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  /** 站点公开地址，用于拼邮箱验证的回调链接。本地是 http://localhost:3000 */
  get siteUrl() {
    return (
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
    );
  },
};
