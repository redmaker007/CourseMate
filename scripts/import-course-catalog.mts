/**
 * 把学校官方公开课表（Google Sheet 导出的 .xlsx）导入 course_catalog。
 *
 * 默认只做预演并打印报告，不写库。确认无误后加 --apply 才真正写入。
 *
 *   node scripts/import-course-catalog.mts --file courses.xlsx --school uw-madison
 *   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import-course-catalog.mts \
 *     --file courses.xlsx --school uw-madison --apply
 *
 * service_role key 只从进程环境变量读，**不从 .env.local 读**。这是刻意的：
 * 那把钥匙绕过全部 RLS，不该落在磁盘上等着被误提交。用完即弃。
 *
 * 数据来源必须是学校官方公开发布的课表。为什么不逆向学校的选课接口，
 * 见 docs/adr/0002-do-not-reverse-engineer-university-course-search.md。
 */

import { parseArgs } from "node:util";

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

import {
  dedupeByCode,
  findSubjectCollisions,
  looksLikeHeaderRow,
  parseCourseRow,
  cleanCell,
  cleanRequired,
  type CatalogRecord,
  type RowIssue,
  type SubjectRef,
} from "./course-catalog-parse.mts";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    school: { type: "string" },
    index: { type: "string", default: "Index" },
    apply: { type: "boolean", default: false },
  },
});

if (!values.file || !values.school) {
  console.error(
    "用法：node scripts/import-course-catalog.mts --file <xlsx> --school <school_id> [--index <索引页名>] [--apply]",
  );
  process.exit(1);
}

const FILE = values.file;
const SCHOOL_ID = values.school;
const APPLY = values.apply;

// ---------------------------------------------------------------------------
// 读取工作簿
// ---------------------------------------------------------------------------

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(FILE);

/** 索引页：Subject Code | Short Name | Full Department Name | Course Count | Sheet */
function readSubjectIndex(): SubjectRef[] {
  const sheet =
    workbook.getWorksheet(values.index!) ??
    workbook.worksheets.find((candidate) =>
      /index|subject/i.test(candidate.name),
    );
  if (!sheet) {
    throw new Error(
      `找不到索引页。用 --index 指定它的名字。工作簿里有：${workbook.worksheets
        .map((s) => s.name)
        .join(", ")}`,
    );
  }

  const subjects: SubjectRef[] = [];
  sheet.eachRow((row, rowNumber) => {
    const cells = (row.values as unknown[]).slice(1);
    if (rowNumber === 1 || /short name/i.test(cleanRequired(cells[1]))) return;

    const shortName = cleanRequired(cells[1]);
    if (!shortName) return;

    const count = Number(cleanCell(cells[3]));
    subjects.push({
      shortName,
      fullName: cleanCell(cells[2]) ?? undefined,
      sourceSubjectCode: cleanCell(cells[0]) ?? undefined,
      expectedCourseCount: Number.isFinite(count) ? count : undefined,
    });
  });

  return subjects;
}

const subjects = readSubjectIndex();
console.log(`索引页读到 ${subjects.length} 个学科`);

// 撞车必须在写库之前发现：两个学科规范化后同名，课号会挤进同一个唯一键。
const collisions = findSubjectCollisions(subjects);
if (collisions.length > 0) {
  console.error("\n学科缩写规范化后发生冲突，必须先处理：");
  for (const collision of collisions) {
    console.error(`  ${collision.normalized} ← ${collision.shortNames.join(" / ")}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 解析各院系分页
// ---------------------------------------------------------------------------

const parsed: { sheet: string; row: number; record: CatalogRecord }[] = [];
const issues: RowIssue[] = [];
const perSheetCounts = new Map<string, number>();

const indexSheetName =
  workbook.getWorksheet(values.index!)?.name ??
  workbook.worksheets.find((s) => /index|subject/i.test(s.name))?.name;

for (const sheet of workbook.worksheets) {
  if (sheet.name === indexSheetName) continue;

  let kept = 0;
  sheet.eachRow((row, rowNumber) => {
    const cells = (row.values as unknown[]).slice(1);
    if (looksLikeHeaderRow(cells)) return;
    if (cells.every((cell) => cleanCell(cell) === null)) return;

    const result = parseCourseRow(cells, subjects);
    if (!result.ok) {
      issues.push({
        sheet: sheet.name,
        row: rowNumber,
        code: cleanRequired(cells[0]),
        reason: result.reason,
      });
      return;
    }
    parsed.push({ sheet: sheet.name, row: rowNumber, record: result.record });
    kept += 1;
  });

  perSheetCounts.set(sheet.name, kept);
}

const { kept: records, duplicates } = dedupeByCode(parsed);

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

console.log(`\n解析成功 ${parsed.length} 行，去重后 ${records.length} 门课`);

// 索引页自带 Course Count，拿它对账——源数据自带校验基准很难得，一定要用。
const mismatches: string[] = [];
for (const subject of subjects) {
  if (subject.expectedCourseCount === undefined) continue;
  const actual = perSheetCounts.get(subject.shortName);
  if (actual === undefined) {
    mismatches.push(`  ${subject.shortName}：索引页说有 ${subject.expectedCourseCount} 门，但找不到对应分页`);
  } else if (actual !== subject.expectedCourseCount) {
    mismatches.push(`  ${subject.shortName}：索引页说 ${subject.expectedCourseCount} 门，实际解析出 ${actual} 门`);
  }
}

if (mismatches.length > 0) {
  console.log(`\n与索引页 Course Count 对不上的院系（${mismatches.length} 个）：`);
  console.log(mismatches.slice(0, 20).join("\n"));
  if (mismatches.length > 20) console.log(`  …还有 ${mismatches.length - 20} 个`);
} else {
  console.log("每个院系的课程数都与索引页 Course Count 一致");
}

if (issues.length > 0) {
  console.log(`\n无法解析的行（${issues.length} 行）：`);
  for (const issue of issues.slice(0, 20)) {
    console.log(`  ${issue.sheet} 第 ${issue.row} 行：${issue.reason}`);
  }
  if (issues.length > 20) console.log(`  …还有 ${issues.length - 20} 行`);
}

if (duplicates.length > 0) {
  console.log(`\n重复课号（${duplicates.length} 行，已保留第一条）：`);
  for (const duplicate of duplicates.slice(0, 20)) {
    console.log(`  ${duplicate.sheet} 第 ${duplicate.row} 行 ${duplicate.code}：${duplicate.reason}`);
  }
  if (duplicates.length > 20) console.log(`  …还有 ${duplicates.length - 20} 行`);
}

if (!APPLY) {
  console.log("\n这是预演，没有写入任何数据。确认以上报告无误后加 --apply 执行。");
  process.exit(issues.length > 0 || mismatches.length > 0 ? 2 : 0);
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "\n--apply 需要环境变量 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。\n" +
      "service_role key 请只在这一条命令前临时提供，不要写进 .env.local：\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import-course-catalog.mts ... --apply",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

const rows = records.map((record) => ({
  school_id: SCHOOL_ID,
  code: record.code,
  subject: record.subject,
  number: record.number,
  title: record.title,
  credits: record.credits,
  department: record.department,
  typically_offered: record.typicallyOffered,
  requisites: record.requisites,
  description: record.description,
  source_course_id: record.sourceCourseId,
  source_term: record.sourceTerm,
  updated_at: new Date().toISOString(),
}));

// 先只写一行做预检。冲突目标写错、字段名不对这类问题，宁可在第 1 行暴露，
// 也不要跑到第 5000 行才发现。
console.log("\n预检：先写入 1 行…");
const preflight = await supabase
  .from("course_catalog")
  .upsert(rows.slice(0, 1), { onConflict: "school_id,code_normalized" });

if (preflight.error) {
  console.error("预检失败，没有继续：", preflight.error.message);
  process.exit(1);
}
console.log("预检通过");

const BATCH = 500;
let written = 1;
for (let index = 1; index < rows.length; index += BATCH) {
  const batch = rows.slice(index, index + BATCH);
  const { error } = await supabase
    .from("course_catalog")
    .upsert(batch, { onConflict: "school_id,code_normalized" });

  if (error) {
    console.error(`\n第 ${index} 行起的批次写入失败：${error.message}`);
    console.error(`已写入 ${written} 行。修正后重跑即可——写入是 upsert，可重复执行。`);
    process.exit(1);
  }
  written += batch.length;
  process.stdout.write(`\r已写入 ${written}/${rows.length}`);
}

console.log(`\n完成：${SCHOOL_ID} 共 ${written} 门课`);
