import {
  describeAuditAction,
  formatAuditTime,
  summarizeAuditDetails,
} from "../audit-format";
import type { AuditEntry } from "../queries";

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-600">还没有任何管理操作。</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((entry) => {
        const summary = [entry.target, summarizeAuditDetails(entry.action, entry.details)]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-sm"
            key={entry.id}
          >
            <time
              className="tabular-nums text-slate-500"
              dateTime={entry.createdAt}
            >
              {formatAuditTime(entry.createdAt)}
            </time>
            <span className="font-medium text-slate-900">
              {entry.actorName ?? entry.actorEmail ?? "已删除的账号"}
            </span>
            <span className="text-slate-800">
              {describeAuditAction(entry.action)}
            </span>
            {summary ? <span className="text-slate-600">{summary}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
