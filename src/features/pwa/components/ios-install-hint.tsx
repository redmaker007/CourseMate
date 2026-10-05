"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { detectInstallMode } from "../install-mode";
import { shouldShowIosHint } from "../ios-install-hint";

const STORAGE_KEY = "coursemate:ios-install-hint-dismissed-at";

function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

/**
 * iPhone 上还没装到主屏幕时，在页面底部给一条提示。
 *
 * iOS 不允许网页自动弹出「添加到主屏幕」；能做到的最接近的方式是点击按钮后
 * 调用系统分享面板（navigator.share），面板里就有「添加到主屏幕」。
 * 不支持分享面板时退回文字步骤。
 */
export function IosInstallHint() {
  const [visible, setVisible] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mode = detectInstallMode({
      standalone,
      hasInstallPrompt: false,
      userAgent: navigator.userAgent,
    });
    if (mode !== "ios") return;
    if (!shouldShowIosHint(readDismissedAt(), Date.now())) return;
    // 挂载后才能读浏览器环境，服务端渲染时没有这些信息
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // 存不了只会让提示下次还出现，不影响使用
    }
    setVisible(false);
  }

  async function openShareSheet() {
    if (typeof navigator.share !== "function") {
      setShowSteps(true);
      return;
    }
    try {
      await navigator.share({ title: "课友 CourseMate", url: window.location.origin });
    } catch {
      // 用户取消分享面板不算错误；其他失败时给出文字步骤
      setShowSteps(true);
    }
  }

  return (
    <div
      className="fixed inset-x-3 z-50 rounded-xl border border-line bg-card p-3 shadow-lg"
      role="dialog"
      aria-label="添加到主屏幕"
      style={{ bottom: "calc(var(--tab-bar-height) + 8px)" }}
    >
      <button
        aria-label="不再提示"
        className="absolute right-2 top-2 rounded-md p-1 text-muted"
        onClick={dismiss}
        type="button"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
      <p className="pr-6 text-sm font-semibold text-ink">添加到主屏幕，像 App 一样打开</p>
      <p className="mt-1 text-xs leading-5 text-muted">没有浏览器地址栏，也能收到消息通知。</p>
      {showSteps ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          点 Safari 底部的
          <Share className="mx-1 inline align-text-bottom" size={13} strokeWidth={1.75} />
          分享按钮，再选「添加到主屏幕」。
        </p>
      ) : (
        <button
          className="mt-2 h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover"
          onClick={openShareSheet}
          type="button"
        >
          添加到主屏幕
        </button>
      )}
    </div>
  );
}
