"use client";

import { useActionState, useId, type ReactNode } from "react";

import {
  initialAdminActionState,
  type AdminActionState,
} from "../admin-action-state";

export type AdminAction = (
  previousState: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export const inputClassName =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:bg-panel";

const BUTTON_TONES = {
  primary:
    "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "rounded-lg bg-badge px-4 py-2 text-sm font-semibold text-white transition hover:bg-badge disabled:cursor-not-allowed disabled:opacity-40",
  quiet:
    "rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50",
} as const;

type AdminFormProps = {
  action: AdminAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  /** danger 用于影响面大的操作（切换学期、关闭学校）。 */
  tone?: keyof typeof BUTTON_TONES;
  /** inline 让字段和按钮排成一行，适合单个输入框或纯按钮的表单。 */
  layout?: "stack" | "inline";
};

/** 管理页的通用表单：提交期间禁用字段，结果以一行提示显示在表单下方。 */
export function AdminForm({
  action,
  children,
  submitLabel,
  pendingLabel = "处理中…",
  tone = "primary",
  layout = "stack",
}: AdminFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialAdminActionState,
  );
  const inline = layout === "inline";

  return (
    <form
      action={formAction}
      className={inline ? "flex flex-wrap items-end gap-2" : "space-y-3"}
    >
      <fieldset
        className={inline ? "contents" : "space-y-3"}
        disabled={pending}
      >
        {children}
      </fieldset>
      <button className={BUTTON_TONES[tone]} disabled={pending} type="submit">
        {pending ? pendingLabel : submitLabel}
      </button>
      {state.status !== "idle" ? (
        <p
          aria-live="polite"
          className={`${inline ? "basis-full" : ""} rounded-lg border px-3 py-2 text-sm ${
            state.status === "success"
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

type TextFieldProps = {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  type?: "text" | "email";
  defaultValue?: string;
};

export function TextField({
  label,
  name,
  placeholder,
  required,
  maxLength,
  type = "text",
  defaultValue,
}: TextFieldProps) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <label className="block text-xs font-medium text-muted" htmlFor={id}>
        {label}
      </label>
      <input
        className={inputClassName}
        defaultValue={defaultValue}
        id={id}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </div>
  );
}

type SchoolSelectProps = {
  schools: { id: string; label: string }[];
  name?: string;
  label?: string;
};

export function SchoolSelect({
  schools,
  name = "schoolId",
  label = "学校",
}: SchoolSelectProps) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <label className="block text-xs font-medium text-muted" htmlFor={id}>
        {label}
      </label>
      <select
        className={inputClassName}
        defaultValue={schools[0]?.id}
        id={id}
        name={name}
        required
      >
        {schools.map((school) => (
          <option key={school.id} value={school.id}>
            {school.label}
          </option>
        ))}
      </select>
    </div>
  );
}
