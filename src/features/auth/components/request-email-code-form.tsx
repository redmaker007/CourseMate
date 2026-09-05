"use client";

import { useActionState, useEffect, useState } from "react";

import type { EnabledSchool } from "../queries";
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
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function verificationMessageTone(
  status: VerifyEmailCodeActionState["status"],
) {
  if (status === "signed_in" || status === "already_signed_in") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
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
        <label className="block text-sm font-medium text-slate-700" htmlFor="code">
          6 位验证码
        </label>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-2xl tracking-[0.35em] text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
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
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
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
        className="w-full px-4 py-2 text-sm font-medium text-indigo-700 transition hover:text-indigo-950 disabled:cursor-not-allowed disabled:text-slate-400"
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
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
        <p className="text-sm text-indigo-700">邮件服务已接受发送请求</p>
        <p className="mt-1 break-all font-medium text-indigo-950">
          {activeState.email}
        </p>
        <p className="mt-2 text-sm text-indigo-700">
          请检查收件箱和垃圾邮件。邮件是否最终送达由邮件服务商决定。
        </p>
      </div>

      <VerifyCodeForm
        key={activeState.verificationContext}
        verificationContext={activeState.verificationContext}
        verifyAction={verifyAction}
      />

      <ResendCodeForm
        key={activeState.verificationContext}
        action={resendAction}
        email={activeState.email}
        pending={resendPending}
        schoolId={activeState.schoolId}
      />

      <button
        className="w-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
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

  if (state.status === "code_sent" && !editingEmail) {
    return (
      <VerificationStep
        initialState={state}
        key={state.verificationContext}
        onEditEmail={() => setEditingEmail(true)}
        requestAction={requestAction}
        verifyAction={verifyAction}
      />
    );
  }

  return (
    <form
      action={(formData) => {
        setEditingEmail(false);
        formAction(formData);
      }}
      className="space-y-5"
    >
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor="schoolId">
          学校
        </label>
        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          defaultValue=""
          disabled={pending || schools.length === 0}
          id="schoolId"
          name="schoolId"
          required
        >
          <option disabled value="">
            请选择学校
          </option>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.nameZh} · {school.nameEn}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor="email">
          学校邮箱
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          disabled={pending || schools.length === 0}
          id="email"
          inputMode="email"
          name="email"
          placeholder="name@wisc.edu"
          required
          type="email"
        />
        <p className="text-sm text-slate-500">请输入完整邮箱地址，系统不会自动补全后缀。</p>
      </div>

      <button
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        disabled={pending || schools.length === 0}
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
