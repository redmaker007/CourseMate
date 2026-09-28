import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

import { LatencyBadge } from "@/features/latency/components/latency-badge";
import { parseThemePreference, THEME_COOKIE } from "@/features/theme/theme-preference";
import "./globals.css";

// 中文不加载网页字体，交给系统自带的苹方 / 微软雅黑：中文字体文件太大，会拖慢首屏。
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CourseMate 学校邮箱登录",
  description: "使用学校邮箱验证码登录 CourseMate",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 按 cookie 直接输出主题，首屏就是正确的颜色（见 features/theme/theme-preference.ts）
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} h-full antialiased`}
      data-theme={theme}
      // 切换主题时前端会直接改 data-theme，和服务端首屏的值不同是预期的
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {children}
        <LatencyBadge />
      </body>
    </html>
  );
}
