import type { CookieOptions } from "@supabase/ssr";

export function hardenSessionCookieOptions(
  options: CookieOptions,
  secureConnection: boolean,
): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: secureConnection || options.secure === true,
  };
}
