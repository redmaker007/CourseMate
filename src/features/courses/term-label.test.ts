import { describe, expect, it } from "vitest";

import { expandSubjectAliases } from "./course-aliases";
import { formatTerm } from "./term-label";

describe("formatTerm", () => {
  it("学期代码转成中文", () => {
    expect(formatTerm("2026-fall")).toBe("2026 秋季");
    expect(formatTerm("2027-Winter")).toBe("2027 冬季");
    expect(formatTerm("2027-spring")).toBe("2027 春季");
  });

  it("认不出的格式原样返回", () => {
    expect(formatTerm("Fall 2026")).toBe("Fall 2026");
    expect(formatTerm("2026-q3")).toBe("2026-q3");
  });
});

describe("expandSubjectAliases", () => {
  it("缩写、全称、连写都能认出", () => {
    expect(expandSubjectAliases("uw-madison", "cs 540")).toEqual(["COMPSCI540"]);
    expect(expandSubjectAliases("uw-madison", "CS540")).toEqual(["COMPSCI540"]);
    expect(expandSubjectAliases("uw-madison", "computer science")).toEqual(["COMPSCI"]);
    expect(expandSubjectAliases("msu", "comp sci 231")).toEqual(["CSE231"]);
  });

  it("没列出的学科或学校、纯数字查询不扩展", () => {
    expect(expandSubjectAliases("uw-madison", "underwater basket weaving")).toEqual([]);
    expect(expandSubjectAliases("no-such-school", "cs 540")).toEqual([]);
    expect(expandSubjectAliases("uw-madison", "540")).toEqual([]);
  });

  it("原文已经是本校课号时不重复", () => {
    expect(expandSubjectAliases("umich", "eecs 280")).toEqual([]);
    expect(expandSubjectAliases("umich", "ece 216")).toEqual(["EECS216"]);
  });
});
