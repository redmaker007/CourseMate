/** 用户点「不再提示」后多久才会再提醒一次（毫秒）。 */
export const IOS_HINT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * iOS 不允许网页自动弹出「添加到主屏幕」，只能提示用户自己点。
 * 没有关闭过就显示；关闭过则等够 IOS_HINT_SNOOZE_MS 再提醒，避免每次打开都打扰。
 */
export function shouldShowIosHint(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null || Number.isNaN(dismissedAt)) return true;
  return now - dismissedAt >= IOS_HINT_SNOOZE_MS;
}
