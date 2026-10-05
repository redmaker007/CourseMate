import { describe, expect, it } from "vitest";

import { courseColor, formatBadge, navSectionFor, shortCourseCode } from "./navigation";

describe("shortCourseCode", () => {
  it("取学科缩写前 4 个字母加最后一段课号", () => {
    expect(shortCourseCode("COMPSCI 300")).toBe("COMP 300");
    expect(shortCourseCode("MATH 221")).toBe("MATH 221");
  });

  it("学科缩写本身带空格时仍取最后一段作课号", () => {
    expect(shortCourseCode("ACCT I S 100")).toBe("ACCT 100");
  });

  it("没有空格的课号直接截断", () => {
    expect(shortCourseCode("CS300ABCDE")).toBe("CS300A");
  });
});

describe("courseColor", () => {
  it("8 色循环", () => {
    expect(courseColor(0)).toBe("var(--course-0)");
    expect(courseColor(9)).toBe("var(--course-1)");
  });
});

describe("navSectionFor", () => {
  it.each([
    ["/dashboard", "dashboard"],
    ["/courses/abc", "course"],
    ["/friends", "messages"],
    ["/friends/filtered", "messages"],
    ["/messages/abc", "messages"],
    ["/profile", "profile"],
    ["/admin", "other"],
  ] as const)("%s → %s", (pathname, section) => {
    expect(navSectionFor(pathname)).toBe(section);
  });
});

describe("formatBadge", () => {
  it("超过 99 显示 99+", () => {
    expect(formatBadge(5)).toBe("5");
    expect(formatBadge(120)).toBe("99+");
  });
});
