"use client";

import { useActionState, useEffect, useState } from "react";

import type { EnabledSchool } from "../queries";
import { emailDomain, schoolForEmail } from "../school-email";
import {
  EMAIL_RESEND_INTERVAL_SECONDS,
  getResendCountdown,
} from "../resend-countdown";
import {
  initialRequestEmailCodeState,
  type RequestEmailCodeActionState,
} from "../request-email-code-state";
import {
  initialVerifyEmailCodeState,
  type VerifyEmailCodeActionState,
} from "../verify-email-code-state";

function messageTone(status: RequestEmailCodeActionState["status"]) {
  if (status === "code_sent" || status === "already_signed_in") {
    return "border-success/30 bg-success-soft text-success";
  }
  return "border-badge/30 bg-badge/10 text-badge";
}

function verificationMessageTone(
  status: VerifyEmailCodeActionState["status"],
) {
  if (status === "signed_in" || status === "already_signed_in") {
    return "border-success/30 bg-success-soft text-success";
  }
  return "border-badge/30 bg-badge/10 text-badge";
}

type CodeSentState = Extract<
  RequestEmailCodeActionState,
  { status: "code_sent" }
>;

type RequestAction = (
  previousState: RequestEmailCodeActionState,
  formData: FormData,
) => Promise<RequestEmailCodeActionState>;

type VerifyAction = (
  previousState: VerifyEmailCodeActionState,
  formData: FormData,
) => Promise<VerifyEmailCodeActionState>;

function VerifyCodeForm({
  verificationContext,
  verifyAction,
}: {
  verificationContext: string;
  verifyAction: VerifyAction;
}) {
  const [state, formAction, pending] = useActionState(
    verifyAction,
    initialVerifyEmailCodeState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input
        name="verificationContext"
        type="hidden"
        value={verificationContext}
      />

      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="code">
          6 位验证码
        </label>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="w-full h-14 rounded-xl border-2 border-line bg-canvas px-4 text-center text-2xl font-bold tracking-[0.35em] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          disabled={pending}
          id="code"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
      </div>

      <button
        className="w-full h-12 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        disabled={pending}
        type="submit"
      >
        {pending ? "正在验证…" : "验证并登录"}
      </button>

      {state.status !== "idle" ? (
        <p
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${verificationMessageTone(state.status)}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ResendCodeForm({
  email,
  schoolId,
  action,
  pending,
}: {
  email: string;
  schoolId: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [countdown, setCountdown] = useState({
    remainingSeconds: EMAIL_RESEND_INTERVAL_SECONDS,
    canResend: false,
  });

  useEffect(() => {
    const sentAt = Date.now();
    const updateCountdown = () =>
      setCountdown(getResendCountdown(sentAt, Date.now()));

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <form action={action}>
      <input name="schoolId" type="hidden" value={schoolId} />
      <input name="email" type="hidden" value={email} />
      <button
        className="w-full px-4 py-2 text-sm font-medium text-accent transition hover:opacity-80 disabled:cursor-not-allowed disabled:text-muted"
        disabled={!countdown.canResend || pending}
        type="submit"
      >
        {pending
          ? "正在重新请求…"
          : countdown.canResend
            ? "重新发送验证码"
            : `${countdown.remainingSeconds} 秒后可重新发送`}
      </button>
    </form>
  );
}

function VerificationStep({
  initialState,
  requestAction,
  verifyAction,
  onEditEmail,
}: {
  initialState: CodeSentState;
  requestAction: RequestAction;
  verifyAction: VerifyAction;
  onEditEmail: () => void;
}) {
  const [resendState, resendAction, resendPending] = useActionState(
    requestAction,
    initialState,
  );
  const activeState =
    resendState.status === "code_sent" ? resendState : initialState;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-brand/20 bg-brand-soft px-4 py-3">
        <p className="text-sm text-brand">邮件服务已接受发送请求</p>
        <p className="mt-1 break-all font-medium text-ink">
          {activeState.email}
        </p>
        <p className="mt-2 text-sm text-muted">
          请检查收件箱和垃圾邮件。邮件是否最终送达由邮件服务商决定。
        </p>
      </div>

      <VerifyCodeForm
        key={`verify-${activeState.flowId}`}
        verificationContext={activeState.verificationContext}
        verifyAction={verifyAction}
      />

      <ResendCodeForm
        key={`resend-${activeState.flowId}`}
        action={resendAction}
        email={activeState.email}
        pending={resendPending}
        schoolId={activeState.schoolId}
      />

      <button
        className="w-full px-4 py-2 text-sm font-medium text-accent transition hover:opacity-80"
        disabled={resendPending}
        onClick={onEditEmail}
        type="button"
      >
        更换学校或邮箱
      </button>

      {resendState.status !== "code_sent" ? (
        <p
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${messageTone(resendState.status)}`}
          role="status"
        >
          {resendState.message}
        </p>
      ) : null}
    </div>
  );
}

export function RequestEmailCodeForm({
  schools,
  requestAction,
  verifyAction,
}: {
  schools: EnabledSchool[];
  requestAction: RequestAction;
  verifyAction: VerifyAction;
}) {
  const [state, formAction, pending] = useActionState(
    requestAction,
    initialRequestEmailCodeState,
  );
  const [editingEmail, setEditingEmail] = useState(false);
  const [email, setEmail] = useState("");

  if (state.status === "code_sent" && !editingEmail) {
    return (
      <VerificationStep
        initialState={state}
        key={`verification-${state.flowId}`}
        onEditEmail={() => setEditingEmail(true)}
        requestAction={requestAction}
        verifyAction={verifyAction}
      />
    );
  }

  // 不再让用户先选学校：按邮箱后缀直接认出学校，认不出就说明支持哪些后缀。
  const detectedSchool = schoolForEmail(schools, email);
  const typedDomain = emailDomain(email);
  const supportedDomains = schools
    .flatMap((school) => school.emailDomains.map((domain) => `@${domain}`))
    .join("、");

  return (
    <form
      action={(formData) => {
        setEditingEmail(false);
        formAction(formData);
      }}
      className="space-y-5"
    >
      <input name="schoolId" type="hidden" value={detectedSchool?.id ?? ""} />

      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink" htmlFor="email">
          学校邮箱
        </label>
        <input
          autoComplete="email"
          className="w-full h-12 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
          disabled={pending || schools.length === 0}
          id="email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="输入完整的学校邮箱"
          required
          type="email"
          value={email}
        />
        {detectedSchool ? (
          <p className="text-xs text-success" role="status">
            已识别：{detectedSchool.nameZh} · {detectedSchool.nameEn}
          </p>
        ) : typedDomain ? (
          <p className="text-xs text-badge" role="status">
            暂不支持 @{typedDomain}。目前开放：{supportedDomains}（需完全一致，子域名邮箱不可用）。
          </p>
        ) : (
          <ul className="space-y-0.5 text-xs text-muted">
            <li>根据邮箱后缀自动识别学校，目前开放：</li>
            {schools.map((school) => (
              <li key={school.id}>
                {school.nameZh} · {school.nameEn}（
                {school.emailDomains.map((domain) => `@${domain}`).join("、")}）
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        className="w-full h-12 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        disabled={pending || !detectedSchool}
        type="submit"
      >
        {pending ? "正在发送…" : "发送验证码"}
      </button>

      {state.status !== "idle" ? (
        <p
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${messageTone(state.status)}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
