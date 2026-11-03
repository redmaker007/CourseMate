import { describe, expect, it } from "vitest";

import { checkProductionRef } from "./check-production-ref.mjs";

describe("checkProductionRef", () => {
  it("allows production builds from main", () => {
    expect(checkProductionRef({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" })).toEqual({ ok: true });
  });

  it("rejects a feature-branch preview promoted to production", () => {
    const result = checkProductionRef({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "feature/password-sign-in",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("feature/password-sign-in");
  });

  it("rejects production builds whose branch is unknown", () => {
    expect(checkProductionRef({ VERCEL_ENV: "production" }).ok).toBe(false);
  });

  it("leaves preview and local builds alone", () => {
    expect(checkProductionRef({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/x" })).toEqual({ ok: true });
    expect(checkProductionRef({})).toEqual({ ok: true });
  });
});
