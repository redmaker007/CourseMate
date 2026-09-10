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
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100";

const BUTTON_TONES = {
  primary:
    "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300",
  danger:
    "rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300",
  quiet:
    "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
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
      <label className="block text-xs font-medium text-slate-600" htmlFor={id}>
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
      <label className="block text-xs font-medium text-slate-600" htmlFor={id}>
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
