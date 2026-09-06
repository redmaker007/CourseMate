import type { EmailCodeRequestResult } from "./email-otp-service";

export type RequestEmailCodeActionState =
  | { status: "idle"; message: "" }
  | (Extract<EmailCodeRequestResult, { status: "code_sent" }> & {
      message: string;
      flowId: string;
      verificationContext: string;
    })
  | (Exclude<EmailCodeRequestResult, { status: "code_sent" }> & {
      message: string;
    });

export const initialRequestEmailCodeState: RequestEmailCodeActionState = {
  status: "idle",
  message: "",
};
