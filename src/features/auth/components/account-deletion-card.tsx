"use client";

import { useActionState, useState } from "react";

import { initialWebDeletionState, type WebDeletionState } from "../web-account-deletion-state";

type DeletionAction = (state: WebDeletionState, formData: FormData) => Promise<WebDeletionState>;

const inputClass =
  "w-full h-11 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50";

export function AccountDeletionCard({ action, email }: { action: DeletionAction; email: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, initialWebDeletionState);
  const hasChallenge = Boolean(state.challengeToken && state.receiptToken);
  const ok = state.status === "code_sent";

  return (
    <section aria-labelledby="account-deletion" className="space-y-3 rounded-xl border border-badge/30 bg-card p-4">
      <h2 className="text-sm font-semibold text-badge" id="account-deletion">注销账号</h2>
      {!open ? (
        <>
          <p className="text-xs text-muted">永久删除你的账号和资料，无法恢复。</p>
          <button
            className="h-10 rounded-xl border border-badge/40 px-4 text-sm font-medium text-badge hover:bg-badge/10"
            onClick={() => setOpen(true)}
            type="button"
          >
            我要注销账号
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-ink">
            <li>账号、资料、课程、好友关系、备注、拉黑记录和通知登记会被删除，所有设备都会退出登录。</li>
            <li>你发过的消息会显示为“[消息已删除]”，别人发的消息不受影响。</li>
            <li>涉及你的举报会去掉你的身份后保留，供处理违规使用。</li>
            <li>注销无法撤销；之后用同一邮箱登录会是一个全新的账号。</li>
          </ul>

          {state.status !== "idle" ? (
            <p
              aria-live="polite"
              className={`rounded-xl border px-3 py-2 text-sm ${ok ? "border-success/30 bg-success-soft text-success" : "border-badge/30 bg-badge/10 text-badge"}`}
              role="status"
            >
              {state.message}
            </p>
          ) : null}

          {hasChallenge ? (
            <form action={formAction} className="space-y-3">
              <input name="intent" type="hidden" value="confirm" />
              <input name="challengeToken" type="hidden" value={state.challengeToken} />
              <input name="receiptToken" type="hidden" value={state.receiptToken} />
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
              <label className="flex items-start gap-2 text-xs text-ink">
                <input className="mt-0.5" disabled={pending} name="confirmed" required type="checkbox" />
                我已了解注销后无法恢复
              </label>
              <button
                className="h-11 w-full rounded-xl bg-badge text-sm font-semibold text-white disabled:opacity-50"
                disabled={pending}
                type="submit"
              >
                {pending ? "处理中…" : "永久注销"}
              </button>
            </form>
          ) : null}

          <form action={formAction} className="flex gap-2">
            <input name="intent" type="hidden" value="request" />
            <button
              className="h-10 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-ink disabled:opacity-50"
              disabled={pending}
              type="submit"
            >
              {hasChallenge ? "重新发送验证码" : `发送验证码到 ${email}`}
            </button>
            <button
              className="h-10 rounded-xl px-3 text-sm text-muted hover:text-ink"
              disabled={pending}
              onClick={() => setOpen(false)}
              type="button"
            >
              取消
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
