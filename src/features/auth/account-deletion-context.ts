import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/features/courses/course-identifiers";

export const receiptHash = (receipt: string) => createHash("sha256").update(receipt).digest("hex");
export const isDeletionReceipt = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
type Challenge = { purpose: "account-deletion"; userId: string; email: string; receiptHash: string; expiresAt: number };

export function createDeletionContextCodec(secret: string) {
  if (secret.length < 32) throw new Error("Missing account deletion signing secret");
  const sign = (payload: string) => createHmac("sha256", secret).update(`account-deletion:${payload}`).digest();
  return {
    issue(userId: string, email: string) {
      const receiptToken = randomBytes(32).toString("base64url");
      const context: Challenge = { purpose: "account-deletion", userId, email, receiptHash: receiptHash(receiptToken), expiresAt: Math.floor(Date.now()/1000)+600 };
      const encoded = Buffer.from(JSON.stringify(context)).toString("base64url");
      return { challengeToken: `${encoded}.${sign(encoded).toString("base64url")}`, receiptToken, expiresAt: context.expiresAt };
    },
    read(token: string): Challenge | null {
      try {
        if (token.length > 4096) return null;
        const [encoded, signature, extra] = token.split(".");
        if (!encoded || !signature || extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
        const actual = Buffer.from(signature, "base64url"), expected = sign(encoded);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const context = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Challenge;
        if (context.purpose !== "account-deletion" || !isUuid(context.userId) || typeof context.email !== "string"
          || typeof context.receiptHash !== "string" || !/^[0-9a-f]{64}$/.test(context.receiptHash)
          || !Number.isSafeInteger(context.expiresAt) || context.expiresAt <= Math.floor(Date.now()/1000)) return null;
        return context;
      } catch { return null; }
    },
  };
}
