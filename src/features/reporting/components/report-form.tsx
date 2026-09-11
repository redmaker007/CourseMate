"use client";

import { useActionState, useState } from "react";

import {
  initialReportActionState,
  type ReportActionState,
} from "../report-action-state";
import type { ReportTargetType } from "../reporting-service";

export type ReportAction = (
  previousState: ReportActionState,
  formData: FormData,
) => Promise<ReportActionState>;

const REASONS = [
  ["harassment", "骚扰"],
  ["spam", "垃圾信息"],
  ["impersonation", "冒充他人"],
  ["threat", "威胁"],
  ["inappropriate", "不当内容"],
  ["other", "其他"],
] as const;

export function ReportForm({
  action,
  label = "举报",
  targetId,
  targetType,
}: {
  action: ReportAction;
  label?: string;
  targetId: string;
  targetType: ReportTargetType;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [state, formAction, pending] = useActionState(
    action,
    initialReportActionState,
  );
  const length = Array.from(details.trim()).length;
  const invalid = length > 1000 || (reason === "other" && length < 1);

  if (!open) {
    return (
      <button
        className="text-xs font-semibold text-rose-700 underline"
        onClick={() => setOpen(true)}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      aria-label={label}
      className="mt-2 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-slate-900"
      role="form"
    >
      <input name="targetType" type="hidden" value={targetType} />
      <input name="targetId" type="hidden" value={targetId} />
      <label className="block text-xs font-medium">
        举报原因
        <select
          aria-label="Reason"
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
          name="reason"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        >
          {REASONS.map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium">
        补充说明（可选）
        <textarea
          aria-label="Details"
          className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
          maxLength={2000}
          name="details"
          onChange={(event) => setDetails(event.target.value)}
          required={reason === "other"}
          value={details}
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className={length > 1000 ? "text-xs text-rose-700" : "text-xs text-slate-500"}>
          {length}/1000
        </span>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
            onClick={() => setOpen(false)}
            type="button"
          >
            取消
          </button>
          <button
            aria-label="Submit report"
            className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={pending || invalid}
            type="submit"
          >
            {pending ? "提交中…" : "提交举报"}
          </button>
        </div>
      </div>
      {state.status !== "idle" ? (
        <p aria-live="polite" className="text-xs text-slate-700" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
