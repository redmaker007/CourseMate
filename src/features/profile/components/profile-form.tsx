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
            className="block text-sm font-medium text-ink"
            htmlFor="displayName"
          >
            显示名称
          </label>
          <span className="text-xs text-muted">
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
          className="w-full h-12 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
          defaultValue={initialProfile.displayName}
          disabled={pending}
          id="displayName"
          maxLength={15}
          name="displayName"
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        {state.fieldErrors?.displayName ? (
          <p className="text-sm text-badge" id="displayName-error">
            {state.fieldErrors.displayName}
          </p>
        ) : (
          <p className="text-sm text-muted">
            可以与别人重复，中文字符按一个字符计算。
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-ink"
          htmlFor="major"
        >
          专业（选填）
        </label>
        <input
          aria-describedby={state.fieldErrors?.major ? "major-error" : undefined}
          aria-invalid={Boolean(state.fieldErrors?.major)}
          className="w-full h-12 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
          defaultValue={initialProfile.major ?? ""}
          disabled={pending}
          id="major"
          maxLength={80}
          name="major"
        />
        {state.fieldErrors?.major ? (
          <p className="text-sm text-badge" id="major-error">
            {state.fieldErrors.major}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-ink"
          htmlFor="gradYear"
        >
          毕业年份（选填）
        </label>
        <input
          aria-describedby={
            state.fieldErrors?.gradYear ? "gradYear-error" : undefined
          }
          aria-invalid={Boolean(state.fieldErrors?.gradYear)}
          className="w-full h-12 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
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
          <p className="text-sm text-badge" id="gradYear-error">
            {state.fieldErrors.gradYear}
          </p>
        ) : null}
      </div>

      <button
        className="w-full h-12 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
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
              ? "border-success/30 bg-success-soft text-success"
              : "border-badge/30 bg-badge/10 text-badge"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
