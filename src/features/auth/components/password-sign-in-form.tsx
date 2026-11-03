"use client";

import { useActionState } from "react";

import {
  initialPasswordSignInState,
  type PasswordSignInActionState,
} from "../password-states";

type SignInAction = (
  previousState: PasswordSignInActionState,
  formData: FormData,
) => Promise<PasswordSignInActionState>;

const inputClass =
  "w-full h-12 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50";

export function PasswordSignInForm({
  action,
  onUseCode,
}: {
  action: SignInAction;
  onUseCode: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialPasswordSignInState);
  const success = state.status === "signed_in" || state.status === "already_signed_in";

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="password-email">
          学校邮箱
        </label>
        <input
          autoComplete="username"
          className={inputClass}
          defaultValue={state.status === "idle" ? "" : state.email}
          disabled={pending}
          id="password-email"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="password">
          密码
        </label>
        <input
          autoComplete="current-password"
          className={inputClass}
          disabled={pending}
          id="password"
          name="password"
          required
          type="password"
        />
        <p className="text-xs text-muted">
          第一次使用请先用验证码登录，再到「我的」页设置密码。
        </p>
      </div>

      <button
        className="w-full h-12 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        disabled={pending}
        type="submit"
      >
        {pending ? "正在登录…" : "登录"}
      </button>

      {state.status !== "idle" ? (
        <p
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${
            success
              ? "border-success/30 bg-success-soft text-success"
              : "border-badge/30 bg-badge/10 text-badge"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      {state.status === "reverification_required" ? (
        <button
          className="w-full px-4 py-2 text-sm font-medium text-accent transition hover:opacity-80"
          onClick={onUseCode}
          type="button"
        >
          改用验证码登录
        </button>
      ) : null}
    </form>
  );
}
