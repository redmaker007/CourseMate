type SafeRelativePathOptions = {
  fallback?: string;
  blockedPrefixes?: readonly string[];
};

export function safeRelativePath(
  value: unknown,
  options: SafeRelativePathOptions = {},
) {
  const fallback = options.fallback ?? "/dashboard";
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  try {
    const base = new URL("https://coursemate.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return fallback;

    const isBlocked = options.blockedPrefixes?.some(
      (prefix) =>
        destination.pathname === prefix ||
        destination.pathname.startsWith(`${prefix}/`),
    );
    if (isBlocked) return fallback;

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
