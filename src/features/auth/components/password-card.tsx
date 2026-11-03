"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";

import {
  initialRequestPasswordCodeState,
  initialSetPasswordState,
  type RequestPasswordCodeActionState,
  type SetPasswordActionState,
} from "../password-states";

type RequestAction = (state: RequestPasswordCodeActionState) => Promise<RequestPasswordCodeActionState>;
type SetAction = (state: SetPasswordActionState, formData: FormData) => Promise<SetPasswordActionState>;

const inputClass =
  "w-full h-11 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50";

function Notice({ ok, children }: { ok: boolean; children: string }) {
  return (
    <p
      aria-live="polite"
      className={`rounded-xl border px-3 py-2 text-sm ${
        ok ? "border-success/30 bg-success-soft text-success" : "border-badge/30 bg-badge/10 text-badge"
      }`}
      role="status"
    >
      {children}
    </p>
  );
}

function SetPasswordForm({ action, verificationContext }: { action: SetAction; verificationContext: string }) {
  const [state, formAction, pending] = useActionState(action, initialSetPasswordState);
  if (state.status === "password_set") return <Notice ok>{state.message}</Notice>;

  return (
    <form action={formAction} className="space-y-3">
      <input name="verificationContext" type="hidden" value={verificationContext} />
      <input
        aria-label="6 位验证码"
        autoComplete="one-time-code"
        className={`${inputClass} tracking-[0.3em]`}
        disabled={pending}
        inputMode="numeric"
        maxLength={6}
        minLength={6}
        name="code"
        pattern="[0-9]{6}"
        placeholder="6 位验证码"
        required
      />
      <input
        aria-label="新密码"
        autoComplete="new-password"
        className={inputClass}
        disabled={pending}
        minLength={8}
        name="password"
        placeholder="新密码（至少 8 位）"
        required
        type="password"
      />
      <input
        aria-label="再输一次新密码"
        autoComplete="new-password"
        className={inputClass}
        disabled={pending}
        minLength={8}
        name="confirmPassword"
        placeholder="再输一次新密码"
        required
        type="password"
      />
      <button
        className="h-11 w-full rounded-xl bg-brand text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
        disabled={pending}
        type="submit"
      >
        {pending ? "正在保存…" : "保存密码"}
      </button>
      {state.status !== "idle" ? <Notice ok={false}>{state.message}</Notice> : null}
    </form>
  );
}

/** 「我的」页：设置或修改登录密码。每次都要先收一封验证码，证明是邮箱主人在操作。 */
export function PasswordCard({
  email,
  passwordSet,
  requestAction,
  setAction,
}: {
  email: string;
  passwordSet: boolean | null;
  requestAction: RequestAction;
  setAction: SetAction;
}) {
  const [codeState, sendCode, sending] = useActionState(requestAction, initialRequestPasswordCodeState);

  return (
    <section aria-labelledby="password-settings" className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 text-muted" size={16} strokeWidth={1.75} />
        <div>
          <h2 className="text-sm font-semibold text-ink" id="password-settings">
            登录密码
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {passwordSet === null
              ? "暂时读不到密码状态。"
              : passwordSet
                ? "已设置。可以用学校邮箱和密码登录。"
                : "未设置。设置后可以不等验证码，直接用密码登录。"}
            为了账号安全，每 30 天仍需用验证码登录一次。
          </p>
        </div>
      </div>

      {codeState.status === "code_sent" ? (
        <>
          <p className="text-xs text-muted">验证码已发到 {codeState.email}，10 分钟内有效。</p>
          <SetPasswordForm action={setAction} key={codeState.flowId} verificationContext={codeState.verificationContext} />
        </>
      ) : (
        <form action={sendCode}>
          <button
            className="h-11 w-full rounded-xl border border-line text-sm font-medium text-ink transition hover:bg-canvas disabled:opacity-40"
            disabled={sending}
            type="submit"
          >
            {sending ? "正在发送…" : passwordSet ? `修改密码：发送验证码到 ${email}` : `设置密码：发送验证码到 ${email}`}
          </button>
        </form>
      )}
      {codeState.status !== "idle" && codeState.status !== "code_sent" ? (
        <Notice ok={false}>{codeState.message}</Notice>
      ) : null}
    </section>
  );
}
