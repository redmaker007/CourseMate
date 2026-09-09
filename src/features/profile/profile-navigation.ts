import { safeRelativePath } from "@/lib/safe-relative-path";

export function safeProfileNextPath(value: unknown) {
  return safeRelativePath(value, {
    blockedPrefixes: ["/onboarding/profile"],
  });
}
