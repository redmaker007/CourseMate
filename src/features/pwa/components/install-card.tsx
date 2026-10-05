"use client";

import { Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { detectInstallMode, type InstallMode } from "../install-mode";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

/** 个人资料页的「安装到手机」卡片：Android 一键安装，iPhone 给出添加步骤。 */
export function InstallCard() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<InstallMode>("unsupported");

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const userAgent = navigator.userAgent;
    // 挂载后才能读浏览器环境，服务端渲染时没有这些信息
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(detectInstallMode({ standalone, hasInstallPrompt: false, userAgent }));

    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setMode(detectInstallMode({ standalone, hasInstallPrompt: true, userAgent }));
    }
    function onInstalled() {
      setPrompt(null);
      setMode("installed");
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "unsupported") return null;

  return (
    <section
      aria-labelledby="install-app"
      className="rounded-xl border border-line bg-card p-4"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink" id="install-app">
        <Smartphone size={15} strokeWidth={1.75} />
        安装到手机
      </h2>
      {mode === "installed" ? (
        <p className="mt-1.5 text-xs text-muted">已安装，正在以独立窗口运行。</p>
      ) : null}
      {mode === "prompt" ? (
        <>
          <p className="mt-1.5 text-xs text-muted">装到主屏幕后像 App 一样打开，没有浏览器地址栏。</p>
          <button
            className="mt-3 h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover"
            onClick={async () => {
              await prompt?.prompt();
              setPrompt(null);
            }}
            type="button"
          >
            安装
          </button>
        </>
      ) : null}
      {mode === "ios" ? (
        <p className="mt-1.5 text-xs leading-5 text-muted">
          在 Safari 里点底部的
          <Share className="mx-1 inline align-text-bottom" size={13} strokeWidth={1.75} />
          分享按钮，再选「添加到主屏幕」，之后就能像 App 一样打开。
        </p>
      ) : null}
    </section>
  );
}
