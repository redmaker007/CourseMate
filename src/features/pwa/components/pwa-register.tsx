"use client";

import { useEffect } from "react";

/** 生产环境注册 Service Worker；开发环境不注册，避免干扰热更新。 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败只意味着不能安装、没有离线页，不影响正常使用
    });
  }, []);

  return null;
}
