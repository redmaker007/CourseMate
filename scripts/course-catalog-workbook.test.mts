import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseCatalogWorkbook } from "./course-catalog-parse.mts";

const INDEX_HEADER = [
  "Subject Code",
  "Short Name",
  "Full Department Name",
  "Course Count",
  "Sheet",
];
const COURSE_HEADER = [
  "Course Code",
  "Title",
  "Credits",
  "Subject",
  "Typically Offered",
  "Prerequisites",
  "Description",
  "Source Course ID",
  "Term",
];

/** 用 exceljs 建一本工作簿，再走一遍真实的写出与读入——和管理页读上传文件的路径一致。 */
async function workbookFrom(sheets: Record<string, unknown[][]>) {
  const source = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = source.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await source.xlsx.writeBuffer());
  return loaded;
}

describe("parseCatalogWorkbook", () => {
  it("读索引页、解析各院系分页、去重，并拿 Course Count 对账", async () => {
    const workbook = await workbookFrom({
      Index: [
        INDEX_HEADER,
        ["232", "ACCT I S", "ACCOUNTING AND INFORMATION SYSTEMS", "2", "ACCT I S"],
        ["156", "A A E", "AGRICULTURAL AND APPLIED ECONOMICS", "1", "A A E"],
      ],
      "ACCT I S": [
        COURSE_HEADER,
        ["ACCT I S 100", "Introductory Financial Accounting", "3", "ACCOUNTING", "Fall, Spring", "None", "Basics", "000001", "Fall 2026"],
        ["ACCT I S 211", "Managerial Accounting", "3", "ACCOUNTING", "Not Applicable", "", "", "000002", "Fall 2026"],
        ["ACCT I S 100", "Duplicate Row", "3", "ACCOUNTING", "", "", "", "", ""],
      ],
      "A A E": [COURSE_HEADER, ["ZZZZ 999", "Unknown Subject"]],
    });

    const report = parseCatalogWorkbook(workbook);

    expect(report.subjects.map((subject) => subject.shortName)).toEqual([
      "ACCT I S",
      "A A E",
    ]);
    expect(report.collisions).toEqual([]);
    expect(report.parsedCount).toBe(3);
    expect(report.records.map((record) => record.code)).toEqual([
      "ACCT I S 100",
      "ACCT I S 211",
    ]);
    expect(report.records[1]).toMatchObject({
      subject: "ACCT I S",
      number: "211",
      typicallyOffered: null,
    });
    expect(report.duplicates).toEqual([
      expect.objectContaining({ sheet: "ACCT I S", row: 4, code: "ACCT I S 100" }),
    ]);
    expect(report.issues).toEqual([
      {
        sheet: "A A E",
        row: 2,
        code: "ZZZZ 999",
        reason: "课号无法匹配任何已知学科：ZZZZ 999",
      },
    ]);
    // 对账按去重前的解析数计：ACCT I S 多出的一行正是重复行
    expect(report.mismatches).toEqual([
      { subject: "ACCT I S", expected: 2, actual: 3 },
      { subject: "A A E", expected: 1, actual: 0 },
    ]);
  });

  it("学科缩写规范化后撞车时报出来", async () => {
    const workbook = await workbookFrom({
      Index: [INDEX_HEADER, ["1", "A A E"], ["2", "AAE"]],
    });

    expect(parseCatalogWorkbook(workbook).collisions).toEqual([
      { normalized: "AAE", shortNames: ["A A E", "AAE"] },
    ]);
  });

  it("可以指定改过名的索引页；找不到时报错并列出现有分页", async () => {
    const workbook = await workbookFrom({
      学科表: [INDEX_HEADER, ["1", "EECS", "COMPUTER SCIENCE", "1", "EECS"]],
      EECS: [COURSE_HEADER, ["EECS 280", "Programming"]],
    });

    expect(parseCatalogWorkbook(workbook, "学科表").records).toHaveLength(1);
    expect(() => parseCatalogWorkbook(workbook)).toThrow(
      "找不到索引页。工作簿里有：学科表, EECS",
    );
  });
});
