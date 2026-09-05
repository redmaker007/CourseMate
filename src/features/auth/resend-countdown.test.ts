import { describe, expect, it } from "vitest";

import {
  EMAIL_RESEND_INTERVAL_SECONDS,
  getResendCountdown,
} from "./resend-countdown";

describe("getResendCountdown", () => {
  it("starts at the configured 60-second interval", () => {
    expect(EMAIL_RESEND_INTERVAL_SECONDS).toBe(60);
    expect(getResendCountdown(1_000, 1_000)).toEqual({
      remainingSeconds: 60,
      canResend: false,
    });
  });

  it("rounds partial seconds up so the UI never enables resend early", () => {
    expect(getResendCountdown(1_000, 60_100)).toEqual({
      remainingSeconds: 1,
      canResend: false,
    });
  });

  it("allows resend once the full interval has elapsed", () => {
    expect(getResendCountdown(1_000, 61_000)).toEqual({
      remainingSeconds: 0,
      canResend: true,
    });
  });
});
