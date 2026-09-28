/**
 * 主题偏好：浅色、深色、跟随系统。
 *
 * 存在 cookie 里而不是 localStorage：根 layout 在服务端读 cookie，直接把
 * data-theme 写进 <html>，首屏就是正确的颜色，不会先闪一下浅色再变深。
 * 它只是这台设备上的显示习惯，不是账号数据，不进数据库。
 */
export const THEME_COOKIE = "coursemate-theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** 第一次来、或 cookie 被改成无效值时，跟随系统。 */
export const DEFAULT_THEME: ThemePreference = "system";

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME;
}

/** 一年有效；只是显示偏好，前端脚本需要能写，所以不设 HttpOnly。 */
export function themeCookieString(preference: ThemePreference): string {
  return `${THEME_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
}
