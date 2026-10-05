import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

import { IosInstallHint } from "@/features/pwa/components/ios-install-hint";
import { PwaRegister } from "@/features/pwa/components/pwa-register";
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
  icons: { apple: "/icons/apple-touch-icon.png" },
  // 加到 iPhone 主屏幕后以独立窗口打开；清单见 manifest.ts
  appleWebApp: { capable: true, title: "CourseMate", statusBarStyle: "default" },
};

// viewport-fit=cover 让页面铺到刘海和 Home 条下面，env(safe-area-inset-*) 才有真实数值；
// 底栏与外壳已经按安全区留白（见 mobile-tab-bar.tsx、app-shell.tsx）。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#16171a" },
  ],
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
        <PwaRegister />
        <IosInstallHint />
      </body>
    </html>
  );
}
