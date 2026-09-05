import type { EmailCodeRequestResult } from "./email-otp-service";

export type RequestEmailCodeActionState =
  | { status: "idle"; message: "" }
  | (EmailCodeRequestResult & { message: string });

export const initialRequestEmailCodeState: RequestEmailCodeActionState = {
  status: "idle",
  message: "",
};
