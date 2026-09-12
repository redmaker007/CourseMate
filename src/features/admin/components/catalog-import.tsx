"use client";

import { useId, useState, type ChangeEvent } from "react";

import {
  describeCountMismatch,
  parseCatalogWorkbook,
  type CatalogRecord,
  type CatalogWorkbookReport,
  type WorkbookLike,
} from "../../../../scripts/course-catalog-parse.mts";
import type { AdminActionState } from "../admin-action-state";
import { inputClassName } from "./admin-form";

/**
 * 每批写入的课数。Server Action 的请求体默认上限 1MB，官方课表的课程简介可能
 * 很长，200 门一批留足余量。
 */
export const IMPORT_BATCH_SIZE = 200;

/** 报告里每类问题最多列出的条数，其余只给总数。 */
const REPORT_LIMIT = 20;

type ImportBatchResult =
  | { ok: true; written: number }
  | { ok: false; message: string };

type CatalogImportProps = {
  schools: { id: string; label: string }[];
  importBatch: (
    schoolId: string,
    entries: CatalogRecord[],
  ) => Promise<ImportBatchResult>;
  materialize: (schoolId: string) => Promise<AdminActionState>;
};

type Loaded = { fileName: string; report: CatalogWorkbookReport };

type Status =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "importing"; written: number }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string };

const NETWORK_FAILURE = "网络或服务器出错。";

async function readWorkbook(file: File): Promise<WorkbookLike> {
  // exceljs 体积不小，只在真的选了文件时才加载
  const excel = await import("exceljs");
  // 打包器对这个 CommonJS 包的导出形态不一：有时挂在命名空间上，有时在 default 里
  const Workbook =
    excel.Workbook ??
    (excel as unknown as { default: typeof excel }).default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook;
}

/**
 * 在浏览器里解析官方课表，先给出与命令行脚本一致的报告，确认后分批写入，
 * 最后把目录物化成当前学期的课程。
 *
 * 为什么不把文件传给服务器解析：Server Action 默认只收 1MB 请求体，Vercel 的
 * 硬上限是 4.5MB，整份课表可能超过。解析后分批发送就没有这个问题。
 */
export function CatalogImport({
  schools,
  importBatch,
  materialize,
}: CatalogImportProps) {
  const schoolFieldId = useId();
  const fileFieldId = useId();
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [confirmed, setConfirmed] = useState(false);

  const busy = status.kind === "parsing" || status.kind === "importing";
  const report = loaded?.report;
  const importable = Boolean(
    report &&
      schoolId &&
      report.collisions.length === 0 &&
      report.records.length > 0,
  );
  const schoolLabel =
    schools.find((school) => school.id === schoolId)?.label ?? schoolId;

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setConfirmed(false);
    setLoaded(null);
    if (!file) {
      setStatus({ kind: "idle" });
      return;
    }

    setStatus({ kind: "parsing" });
    try {
      const parsed = parseCatalogWorkbook(await readWorkbook(file));
      setLoaded({ fileName: file.name, report: parsed });
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: `读不了这个文件：${error instanceof Error ? error.message : "格式无法识别"}`,
      });
    }
  }

  async function handleImport() {
    if (!report || !importable) return;

    const records = report.records;
    let written = 0;
    setConfirmed(false);
    setStatus({ kind: "importing", written });

    for (let start = 0; start < records.length; start += IMPORT_BATCH_SIZE) {
      let result: ImportBatchResult;
      try {
        result = await importBatch(
          schoolId,
          records.slice(start, start + IMPORT_BATCH_SIZE),
        );
      } catch {
        result = { ok: false, message: NETWORK_FAILURE };
      }
      if (!result.ok) {
        setStatus({
          kind: "failed",
          message: `写到第 ${start + 1} 门时失败：${result.message}已写入 ${written} 门。导入是覆盖式的，修正后重新导入整份文件即可。`,
        });
        return;
      }
      written += result.written;
      setStatus({ kind: "importing", written });
    }

    let materialized: AdminActionState;
    try {
      materialized = await materialize(schoolId);
    } catch {
      materialized = { status: "error", message: NETWORK_FAILURE };
    }
    setStatus(
      materialized.status === "success"
        ? { kind: "done", message: `目录已写入 ${written} 门。${materialized.message}` }
        : {
            kind: "failed",
            message: `目录已写入 ${written} 门，但生成当前学期课程失败：${materialized.message}可以稍后用下方的「重新生成当前学期课程」补上。`,
          },
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-slate-600"
            htmlFor={schoolFieldId}
          >
            写入哪所学校
          </label>
          <select
            className={inputClassName}
            disabled={busy}
            id={schoolFieldId}
            onChange={(event) => {
              setSchoolId(event.target.value);
              setConfirmed(false);
            }}
            value={schoolId}
          >
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-slate-600"
            htmlFor={fileFieldId}
          >
            官方课表（.xlsx）
          </label>
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
            disabled={busy}
            id={fileFieldId}
            onChange={handleFile}
            type="file"
          />
        </div>
      </div>

      {status.kind === "parsing" ? (
        <p className="text-sm text-slate-600" role="status">
          正在读取课表…
        </p>
      ) : null}

      {loaded ? <ImportReport {...loaded} /> : null}

      {loaded ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              checked={confirmed}
              className="mt-1"
              disabled={!importable || busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              我已核对上面的报告，确认写入 <strong>{schoolLabel}</strong>
              。同一门课再次导入会覆盖原来的内容。
            </span>
          </label>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!confirmed || !importable || busy}
            onClick={handleImport}
            type="button"
          >
            {status.kind === "importing"
              ? `正在写入… ${status.written}/${loaded.report.records.length}`
              : `写入 ${loaded.report.records.length} 门课`}
          </button>
        </div>
      ) : null}

      {status.kind === "done" ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          role="status"
        >
          {status.message}
        </p>
      ) : null}
      {status.kind === "failed" ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          role="alert"
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function ImportReport({ fileName, report }: Loaded) {
  const clean =
    report.collisions.length === 0 &&
    report.mismatches.length === 0 &&
    report.issues.length === 0;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div>
        <p className="font-medium text-slate-900">{fileName}</p>
        <p className="mt-1 text-slate-700">
          索引页 {report.subjects.length} 个学科 · 解析成功 {report.parsedCount} 行 ·
          去重后 {report.records.length} 门课
        </p>
      </div>

      {report.collisions.length ? (
        <IssueList
          items={report.collisions.map(
            (collision) =>
              `${collision.normalized} ← ${collision.shortNames.join(" / ")}`,
          )}
          title="学科缩写规范化后发生冲突，必须先在课表里改正才能导入"
          tone="error"
        />
      ) : null}
      {report.mismatches.length ? (
        <IssueList
          items={report.mismatches.map(describeCountMismatch)}
          title={`与索引页课程数对不上的院系（${report.mismatches.length} 个）`}
          tone="warning"
        />
      ) : null}
      {report.issues.length ? (
        <IssueList
          items={report.issues.map(
            (issue) => `${issue.sheet} 第 ${issue.row} 行：${issue.reason}`,
          )}
          title={`无法解析的行（${report.issues.length} 行），不会写入`}
          tone="warning"
        />
      ) : null}
      {report.duplicates.length ? (
        <IssueList
          items={report.duplicates.map(
            (duplicate) =>
              `${duplicate.sheet} 第 ${duplicate.row} 行 ${duplicate.code}：${duplicate.reason}`,
          )}
          title={`重复课号（${report.duplicates.length} 行，已保留第一条）`}
          tone="neutral"
        />
      ) : null}
      {clean ? (
        <p className="text-emerald-700">
          每个院系的课程数都与索引页一致，没有无法解析的行。
        </p>
      ) : null}
    </div>
  );
}

const ISSUE_TONES = {
  error: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  neutral: "border-slate-200 bg-white text-slate-700",
} as const;

function IssueList({
  items,
  title,
  tone,
}: {
  items: string[];
  title: string;
  tone: keyof typeof ISSUE_TONES;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${ISSUE_TONES[tone]}`}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.slice(0, REPORT_LIMIT).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      {items.length > REPORT_LIMIT ? (
        <p className="mt-1">…还有 {items.length - REPORT_LIMIT} 条</p>
      ) : null}
    </div>
  );
}
