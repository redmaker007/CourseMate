/**
 * 课程目录导入的纯解析逻辑。
 *
 * 刻意不碰文件、网络和数据库——导入脚本最容易出错的是数据清洗那一段，
 * 把它单独拆出来才测得动。CLI 在 import-course-catalog.ts。
 */

/** 学校原文里表示"没有值"的写法。人工整理的表格里这些都当空处理。 */
const EMPTY_SENTINELS = new Set(["", "-", "--", "n/a", "na", "not applicable"]);

export type SubjectRef = {
  /** 课号里用的学科缩写，如 'ACCT I S'。本身可能含空格。 */
  shortName: string;
  /** 院系全名，如 'ACCOUNTING AND INFORMATION SYSTEMS'。 */
  fullName?: string;
  /** 学校内部的学科编号，如 '232'。 */
  sourceSubjectCode?: string;
  /** 索引页声明的课程数，用于导入后对账。 */
  expectedCourseCount?: number;
};

export type CatalogRecord = {
  code: string;
  subject: string;
  number: string;
  title: string;
  credits: string | null;
  department: string | null;
  typicallyOffered: string | null;
  requisites: string | null;
  description: string | null;
  sourceCourseId: string | null;
  sourceTerm: string | null;
};

export type RowIssue = {
  sheet: string;
  row: number;
  code: string;
  reason: string;
};

/**
 * 与数据库里 code_normalized 生成列**完全相同**的规则。
 *
 * 两边必须一致，否则脚本以为没重复、数据库却因唯一索引报错。改这里就要
 * 同步改 migration 里的表达式。
 */
export function normalizeCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** 去掉首尾空白并把内部连续空白压成一个空格；空值哨兵转成 null。 */
export function cleanCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (EMPTY_SENTINELS.has(text.toLowerCase())) return null;
  return text;
}

/** 同上，但用于必填字段：清洗后返回空串而不是 null，方便调用方判空。 */
export function cleanRequired(value: unknown): string {
  return cleanCell(value) ?? "";
}

/**
 * 找出规范化后会互相撞车的学科缩写。
 *
 * 'A A E' 和 'AAE' 去掉空格后都是 'AAE'，两个学科的课号会挤进同一个键，
 * 唯一索引会拒绝后来者。这种情况必须在导入前就发现，而不是导到一半报错。
 */
export function findSubjectCollisions(
  subjects: SubjectRef[],
): { normalized: string; shortNames: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const subject of subjects) {
    const key = normalizeCode(subject.shortName);
    buckets.set(key, [...(buckets.get(key) ?? []), subject.shortName]);
  }
  return [...buckets.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([normalized, shortNames]) => ({ normalized, shortNames }));
}

/**
 * 把 'ACCT I S 100' 拆成学科和课号数字。
 *
 * 不能按空格切——UW 的学科缩写自身含空格（'ACCT I S'、'A A E'）。所以拿
 * 索引页的学科表做**最长前缀匹配**：先按长度降序排，第一个能匹配上的就是答案。
 * 按长度排是必要的，否则 'A A E' 可能被更短的 'A' 抢先匹配掉。
 */
export function splitCourseCode(
  code: string,
  subjects: SubjectRef[],
): { subject: string; number: string } | null {
  const cleaned = cleanRequired(code);
  if (!cleaned) return null;

  const normalizedCode = normalizeCode(cleaned);
  const candidates = [...subjects].sort(
    (left, right) =>
      normalizeCode(right.shortName).length -
      normalizeCode(left.shortName).length,
  );

  for (const candidate of candidates) {
    const prefix = normalizeCode(candidate.shortName);
    if (!prefix || !normalizedCode.startsWith(prefix)) continue;

    const rest = normalizedCode.slice(prefix.length);
    // 剩下的必须是纯数字（可带一个字母后缀，如 '271A'），否则说明这个前缀
    // 只是碰巧匹配上，不是真正的学科。
    if (!/^\d{1,4}[A-Z]?$/.test(rest)) continue;

    return { subject: candidate.shortName, number: rest };
  }

  return null;
}

export type ParsedRow =
  | { ok: true; record: CatalogRecord }
  | { ok: false; reason: string };

/**
 * 解析一行课程。
 *
 * 列顺序对应导出的表头：
 * Course Code | Title | Credits | Subject | Typically Offered |
 * Prerequisites | Description | Source Course ID | Term
 */
export function parseCourseRow(
  cells: unknown[],
  subjects: SubjectRef[],
): ParsedRow {
  const code = cleanRequired(cells[0]);
  const title = cleanRequired(cells[1]);

  if (!code) return { ok: false, reason: "课号为空" };
  if (!title) return { ok: false, reason: "课名为空" };

  const split = splitCourseCode(code, subjects);
  if (!split) {
    return { ok: false, reason: `课号无法匹配任何已知学科：${code}` };
  }

  return {
    ok: true,
    record: {
      code,
      subject: split.subject,
      number: split.number,
      title,
      credits: cleanCell(cells[2]),
      department: cleanCell(cells[3]),
      typicallyOffered: cleanCell(cells[4]),
      requisites: cleanCell(cells[5]),
      description: cleanCell(cells[6]),
      sourceCourseId: cleanCell(cells[7]),
      sourceTerm: cleanCell(cells[8]),
    },
  };
}

/**
 * 在整批数据里找出规范化后重复的课号。
 *
 * 保留第一条，其余作为问题报出——不静默丢弃，因为重复往往说明源数据有问题，
 * 值得人看一眼。
 */
export function dedupeByCode(
  entries: { sheet: string; row: number; record: CatalogRecord }[],
): {
  kept: CatalogRecord[];
  duplicates: RowIssue[];
} {
  const seen = new Map<string, { sheet: string; row: number }>();
  const kept: CatalogRecord[] = [];
  const duplicates: RowIssue[] = [];

  for (const entry of entries) {
    const key = normalizeCode(entry.record.code);
    const first = seen.get(key);
    if (first) {
      duplicates.push({
        sheet: entry.sheet,
        row: entry.row,
        code: entry.record.code,
        reason: `与 ${first.sheet} 第 ${first.row} 行重复（规范化后同为 ${key}）`,
      });
      continue;
    }
    seen.set(key, { sheet: entry.sheet, row: entry.row });
    kept.push(entry.record);
  }

  return { kept, duplicates };
}

/** 表头行的特征词，用于跳过每个分页的第一行。 */
export function looksLikeHeaderRow(cells: unknown[]): boolean {
  const first = cleanRequired(cells[0]).toLowerCase();
  return first === "course code" || first === "code";
}
