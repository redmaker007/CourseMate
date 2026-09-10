import { describe, expect, it } from "vitest";

import {
  cleanCell,
  dedupeByCode,
  findSubjectCollisions,
  looksLikeHeaderRow,
  normalizeCode,
  parseCourseRow,
  splitCourseCode,
  type SubjectRef,
} from "./course-catalog-parse.mts";

const SUBJECTS: SubjectRef[] = [
  { shortName: "ACCT I S", fullName: "ACCOUNTING AND INFORMATION SYSTEMS" },
  { shortName: "ACT SCI", fullName: "ACTUARIAL SCIENCE" },
  { shortName: "A A E", fullName: "AGRICULTURAL AND APPLIED ECONOMICS" },
  { shortName: "AFRICAN", fullName: "AFRICAN CULTURAL STUDIES" },
];

describe("normalizeCode", () => {
  it("与数据库生成列规则一致：去掉非字母数字并转大写", () => {
    expect(normalizeCode("ACCT I S 100")).toBe("ACCTIS100");
    expect(normalizeCode("a a e 215")).toBe("AAE215");
    expect(normalizeCode("EECS-280")).toBe("EECS280");
  });
});

describe("cleanCell", () => {
  it("压缩空白并去掉首尾空格", () => {
    expect(cleanCell("  Intro   to    Accounting ")).toBe(
      "Intro to Accounting",
    );
  });

  it("把学校用来表示空的写法转成 null", () => {
    expect(cleanCell("Not Applicable")).toBeNull();
    expect(cleanCell("not applicable")).toBeNull();
    expect(cleanCell("N/A")).toBeNull();
    expect(cleanCell("")).toBeNull();
    expect(cleanCell("   ")).toBeNull();
    expect(cleanCell(null)).toBeNull();
  });

  it("正常内容原样保留", () => {
    expect(cleanCell("Fall, Spring, Summer")).toBe("Fall, Spring, Summer");
  });
});

describe("splitCourseCode", () => {
  it("拆开含空格的学科缩写", () => {
    expect(splitCourseCode("ACCT I S 100", SUBJECTS)).toEqual({
      subject: "ACCT I S",
      number: "100",
    });
    expect(splitCourseCode("A A E 215", SUBJECTS)).toEqual({
      subject: "A A E",
      number: "215",
    });
  });

  it("学科写法不规范时也能拆", () => {
    expect(splitCourseCode("acctis100", SUBJECTS)).toEqual({
      subject: "ACCT I S",
      number: "100",
    });
  });

  it("保留课号的字母后缀", () => {
    expect(splitCourseCode("AFRICAN 271A", SUBJECTS)).toEqual({
      subject: "AFRICAN",
      number: "271A",
    });
  });

  it("优先匹配更长的学科，避免被短前缀抢走", () => {
    const withOverlap: SubjectRef[] = [
      { shortName: "A" },
      { shortName: "A A E" },
    ];
    expect(splitCourseCode("A A E 215", withOverlap)).toEqual({
      subject: "A A E",
      number: "215",
    });
  });

  it("学科不认识时返回 null，而不是猜一个", () => {
    expect(splitCourseCode("ZZZZ 100", SUBJECTS)).toBeNull();
  });

  it("剩余部分不是课号数字时不当作匹配", () => {
    expect(splitCourseCode("AFRICANSTUDIES", SUBJECTS)).toBeNull();
  });
});

describe("findSubjectCollisions", () => {
  it("找出去掉空格后会撞车的学科", () => {
    const collisions = findSubjectCollisions([
      { shortName: "A A E" },
      { shortName: "AAE" },
      { shortName: "ACT SCI" },
    ]);
    expect(collisions).toEqual([
      { normalized: "AAE", shortNames: ["A A E", "AAE"] },
    ]);
  });

  it("没有撞车时返回空数组", () => {
    expect(findSubjectCollisions(SUBJECTS)).toEqual([]);
  });
});

describe("parseCourseRow", () => {
  const row = [
    "ACCT I S 100",
    "Introductory Financial Accounting",
    "3",
    "ACCOUNTING AND INFORMATION SYSTEMS",
    "Not Applicable",
    "Not open to students with credit for ACCT I S 300",
    "Examines generally accepted accounting principles.",
    "002983",
    "Fall 2026",
  ];

  it("按表头顺序解析一整行", () => {
    const parsed = parseCourseRow(row, SUBJECTS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.record).toEqual({
      code: "ACCT I S 100",
      subject: "ACCT I S",
      number: "100",
      title: "Introductory Financial Accounting",
      credits: "3",
      department: "ACCOUNTING AND INFORMATION SYSTEMS",
      // 'Not Applicable' 必须落成 null，否则界面上会显示这四个字
      typicallyOffered: null,
      requisites: "Not open to students with credit for ACCT I S 300",
      description: "Examines generally accepted accounting principles.",
      sourceCourseId: "002983",
      sourceTerm: "Fall 2026",
    });
  });

  it("缺课号或课名时报错而不是写进库", () => {
    expect(parseCourseRow(["", "Title"], SUBJECTS)).toEqual({
      ok: false,
      reason: "课号为空",
    });
    expect(parseCourseRow(["ACCT I S 100", "  "], SUBJECTS)).toEqual({
      ok: false,
      reason: "课名为空",
    });
  });

  it("学科不认识时报错，不猜", () => {
    const parsed = parseCourseRow(["ZZZZ 100", "Whatever"], SUBJECTS);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("无法匹配");
  });
});

describe("dedupeByCode", () => {
  it("保留第一条，重复的报出来而不是静默丢弃", () => {
    const make = (code: string) => ({
      code,
      subject: "ACCT I S",
      number: "100",
      title: "T",
      credits: null,
      department: null,
      typicallyOffered: null,
      requisites: null,
      description: null,
      sourceCourseId: null,
      sourceTerm: null,
    });

    const result = dedupeByCode([
      { sheet: "ACCT I S", row: 2, record: make("ACCT I S 100") },
      // 写法不同但规范化后相同，必须被认出来
      { sheet: "ACCT I S", row: 9, record: make("acct-i-s-100") },
      { sheet: "ACT SCI", row: 2, record: make("ACT SCI 300") },
    ]);

    expect(result.kept).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].row).toBe(9);
    expect(result.duplicates[0].reason).toContain("第 2 行");
  });
});

describe("looksLikeHeaderRow", () => {
  it("认出表头行", () => {
    expect(looksLikeHeaderRow(["Course Code", "Title"])).toBe(true);
    expect(looksLikeHeaderRow(["ACCT I S 100", "Title"])).toBe(false);
  });
});
