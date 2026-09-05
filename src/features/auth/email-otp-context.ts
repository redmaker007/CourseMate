import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailOtpContext = {
  schoolId: string;
  email: string;
};

type SignedPayload = EmailOtpContext & {
  expiresAt: number;
  version: 1;
};

const DEFAULT_TTL_MS = 10 * 60 * 1_000;

export function createEmailOtpContextCodec(
  secret: string,
  now: () => number = Date.now,
) {
  if (secret.length < 32) {
    throw new Error("EMAIL_OTP_CONTEXT_SECRET must contain at least 32 characters.");
  }

  const sign = (payload: string) =>
    createHmac("sha256", secret).update(payload).digest("base64url");

  return {
    issue(context: EmailOtpContext, ttlMs = DEFAULT_TTL_MS) {
      const payload: SignedPayload = {
        ...context,
        expiresAt: now() + ttlMs,
        version: 1,
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
        "base64url",
      );
      return `${encodedPayload}.${sign(encodedPayload)}`;
    },

    read(token: string): EmailOtpContext | null {
      try {
        const parts = token.split(".");
        if (parts.length !== 2) return null;

        const [encodedPayload, suppliedSignature] = parts;
        if (!encodedPayload || !suppliedSignature) return null;

        const expectedSignature = sign(encodedPayload);
        const suppliedBytes = Buffer.from(suppliedSignature, "base64url");
        const expectedBytes = Buffer.from(expectedSignature, "base64url");
        if (
          suppliedBytes.length !== expectedBytes.length ||
          !timingSafeEqual(suppliedBytes, expectedBytes)
        ) {
          return null;
        }

        const payload = JSON.parse(
          Buffer.from(encodedPayload, "base64url").toString("utf8"),
        ) as Partial<SignedPayload>;

        if (
          payload.version !== 1 ||
          typeof payload.schoolId !== "string" ||
          !payload.schoolId ||
          typeof payload.email !== "string" ||
          !payload.email ||
          typeof payload.expiresAt !== "number" ||
          payload.expiresAt <= now()
        ) {
          return null;
        }

        return { schoolId: payload.schoolId, email: payload.email };
      } catch {
        return null;
      }
    },
  };
}
