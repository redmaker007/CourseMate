export type InstallMode = "installed" | "prompt" | "ios" | "unsupported";

/**
 * 判断「安装到主屏幕」该给用户看什么：
 * - installed：已经是独立窗口（装过了，或在 App 壳里）
 * - prompt：浏览器给了安装事件（Android / 桌面 Chrome），可以一键安装
 * - ios：iOS Safari 没有安装事件，只能引导用户走「分享 → 添加到主屏幕」
 */
export function detectInstallMode(input: {
  standalone: boolean;
  hasInstallPrompt: boolean;
  userAgent: string;
}): InstallMode {
  if (input.standalone) return "installed";
  if (input.hasInstallPrompt) return "prompt";
  if (/iPhone|iPad|iPod/i.test(input.userAgent)) return "ios";
  return "unsupported";
}
