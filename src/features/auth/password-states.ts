import type {
  PasswordCodeRequestResult,
  PasswordSignInResult,
  SetPasswordResult,
} from "./password-service";

export type PasswordSignInActionState =
  | { status: "idle"; message: "" }
  // 提交后 React 会重置表单；带回用户输入的邮箱作为默认值，输错密码时不必重填邮箱。
  | (PasswordSignInResult & { message: string; email: string });

export const initialPasswordSignInState: PasswordSignInActionState = { status: "idle", message: "" };

export type RequestPasswordCodeActionState =
  | { status: "idle"; message: "" }
  | (Extract<PasswordCodeRequestResult, { status: "code_sent" }> & {
      message: string;
      flowId: string;
      verificationContext: string;
    })
  | ((Exclude<PasswordCodeRequestResult, { status: "code_sent" }> | { status: "unauthenticated" }) & {
      message: string;
    });

export const initialRequestPasswordCodeState: RequestPasswordCodeActionState = { status: "idle", message: "" };

export type SetPasswordActionState =
  | { status: "idle"; message: "" }
  | ((SetPasswordResult | { status: "unauthenticated" } | { status: "password_mismatch" }) & {
      message: string;
    });

export const initialSetPasswordState: SetPasswordActionState = { status: "idle", message: "" };
