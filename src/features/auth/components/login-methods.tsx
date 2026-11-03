"use client";

import { useState, type ComponentProps } from "react";

import { PasswordSignInForm } from "./password-sign-in-form";
import { RequestEmailCodeForm } from "./request-email-code-form";

type Method = "code" | "password";

/** 登录页的两种方式。需要重新验证时只留验证码，避免用户反复试密码。 */
export function LoginMethods({
  passwordAction,
  reverificationRequired,
  ...codeProps
}: ComponentProps<typeof RequestEmailCodeForm> & {
  passwordAction: ComponentProps<typeof PasswordSignInForm>["action"];
  reverificationRequired: boolean;
}) {
  const [method, setMethod] = useState<Method>(reverificationRequired ? "code" : "password");

  if (reverificationRequired) {
    return (
      <div className="space-y-5">
        <p className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          距上次邮箱验证已超过 30 天（或密码已失效），请用验证码登录一次。
        </p>
        <RequestEmailCodeForm {...codeProps} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1" role="tablist">
        {(
          [
            ["password", "密码登录"],
            ["code", "验证码登录"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={method === value}
            className={`h-10 rounded-lg text-sm font-medium transition ${
              method === value ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
            key={value}
            onClick={() => setMethod(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {method === "password" ? (
        <PasswordSignInForm action={passwordAction} onUseCode={() => setMethod("code")} />
      ) : (
        <RequestEmailCodeForm {...codeProps} />
      )}
    </div>
  );
}
