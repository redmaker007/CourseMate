"use client";

import { useActionState, useState } from "react";

import {
  initialProfileActionState,
  type ProfileActionState,
} from "../profile-action-state";

type ProfileAction = (
  previousState: ProfileActionState,
  formData: FormData,
) => Promise<ProfileActionState>;

type ProfileFormProps = {
  action: ProfileAction;
  initialProfile: {
    displayName: string;
    major: string | null;
    gradYear: number | null;
  };
  nextPath?: string;
  submitLabel: string;
};

export function ProfileForm({
  action,
  initialProfile,
  nextPath,
  submitLabel,
}: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialProfileActionState,
  );
  const [displayName, setDisplayName] = useState(initialProfile.displayName);

  return (
    <form action={formAction} className="space-y-5">
      {nextPath ? <input name="next" type="hidden" value={nextPath} /> : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <label
            className="block text-sm font-medium text-slate-700"
            htmlFor="displayName"
          >
            显示名称
          </label>
          <span className="text-xs text-slate-500">
            {Array.from(displayName).length}/15
          </span>
        </div>
        <input
          aria-describedby={
            state.fieldErrors?.displayName ? "displayName-error" : undefined
          }
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          autoComplete="nickname"
          autoFocus
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          defaultValue={initialProfile.displayName}
          disabled={pending}
          id="displayName"
          maxLength={15}
          name="displayName"
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        {state.fieldErrors?.displayName ? (
          <p className="text-sm text-rose-700" id="displayName-error">
            {state.fieldErrors.displayName}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            可以与别人重复，中文字符按一个字符计算。
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-slate-700"
          htmlFor="major"
        >
          专业（选填）
        </label>
        <input
          aria-describedby={state.fieldErrors?.major ? "major-error" : undefined}
          aria-invalid={Boolean(state.fieldErrors?.major)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          defaultValue={initialProfile.major ?? ""}
          disabled={pending}
          id="major"
          maxLength={80}
          name="major"
        />
        {state.fieldErrors?.major ? (
          <p className="text-sm text-rose-700" id="major-error">
            {state.fieldErrors.major}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-slate-700"
          htmlFor="gradYear"
        >
          毕业年份（选填）
        </label>
        <input
          aria-describedby={
            state.fieldErrors?.gradYear ? "gradYear-error" : undefined
          }
          aria-invalid={Boolean(state.fieldErrors?.gradYear)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          defaultValue={initialProfile.gradYear ?? ""}
          disabled={pending}
          id="gradYear"
          inputMode="numeric"
          max={2040}
          min={2020}
          name="gradYear"
          type="number"
        />
        {state.fieldErrors?.gradYear ? (
          <p className="text-sm text-rose-700" id="gradYear-error">
            {state.fieldErrors.gradYear}
          </p>
        ) : null}
      </div>

      <button
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        disabled={pending}
        type="submit"
      >
        {pending ? "正在保存…" : submitLabel}
      </button>

      {state.status !== "idle" && state.status !== "invalid" ? (
        <p
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${
            state.status === "saved"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
