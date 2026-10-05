import type { MetadataRoute } from "next";

/**
 * 网页应用清单：让浏览器和 App 壳知道名称、图标与独立窗口显示方式。
 * 图标在 public/icons；这个路径在 proxy 里跳过登录校验，未登录也要能取到。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CourseMate",
    short_name: "CourseMate",
    description: "学校邮箱准入的课程社交平台",
    lang: "zh-CN",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f8f9fb",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
