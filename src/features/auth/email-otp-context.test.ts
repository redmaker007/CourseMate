import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOtpContextCodec } from "./email-otp-context";

const SECRET = "test-secret-with-at-least-thirty-two-characters";

describe("email OTP verification context", () => {
  it("round-trips a short-lived locked school and email context", () => {
    const codec = createEmailOtpContextCodec(SECRET, () => 1_000);
    const token = codec.issue({
      schoolId: "uw-madison",
      email: "Student@wisc.edu",
    });

    expect(codec.read(token)).toEqual({
      schoolId: "uw-madison",
      email: "Student@wisc.edu",
    });
  });

  it("rejects a modified token", () => {
    const codec = createEmailOtpContextCodec(SECRET, () => 1_000);
    const token = codec.issue({
      schoolId: "uw-madison",
      email: "student@wisc.edu",
    });
    const [payload, signature] = token.split(".");
    const modifiedPayload = `${payload?.startsWith("A") ? "B" : "A"}${payload?.slice(1)}`;

    expect(codec.read(`${modifiedPayload}.${signature}`)).toBeNull();
  });

  it("rejects an expired context", () => {
    let now = 1_000;
    const codec = createEmailOtpContextCodec(SECRET, () => now);
    const token = codec.issue(
      { schoolId: "uw-madison", email: "student@wisc.edu" },
      500,
    );

    now = 1_501;
    expect(codec.read(token)).toBeNull();
  });

  it.each(["", "payload", "payload.signature.extra", "not-base64.signature"])(
    "rejects malformed context %s",
    (token) => {
      const codec = createEmailOtpContextCodec(SECRET, () => 1_000);
      expect(codec.read(token)).toBeNull();
    },
  );
});
