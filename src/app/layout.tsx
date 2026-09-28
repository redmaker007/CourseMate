import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LatencyBadge } from "@/features/latency/components/latency-badge";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <LatencyBadge />
      </body>
    </html>
  );
}
