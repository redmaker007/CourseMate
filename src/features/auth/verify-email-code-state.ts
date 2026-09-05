import type { EmailCodeVerificationResult } from "./email-otp-service";

export type VerifyEmailCodeActionState =
  | { status: "idle"; message: "" }
  | (EmailCodeVerificationResult & { message: string });

export const initialVerifyEmailCodeState: VerifyEmailCodeActionState = {
  status: "idle",
  message: "",
};
