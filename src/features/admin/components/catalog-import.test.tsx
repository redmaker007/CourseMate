// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogRecord } from "../../../../scripts/course-catalog-parse.mts";
import { CatalogImport } from "./catalog-import";

afterEach(cleanup);

const SCHOOLS = [
  { id: "uw-madison", label: "威斯康星大学麦迪逊分校（uw-madison）" },
  { id: "umich", label: "密歇根大学（umich）" },
];

const INDEX_HEADER = ["Subject Code", "Short Name", "Full Department Name", "Course Count", "Sheet"];
const COURSE_HEADER = ["Course Code", "Title"];

async function xlsxFile(sheets: Record<string, unknown[][]>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], "courses.xlsx");
}

const EECS_WORKBOOK = {
  Index: [INDEX_HEADER, ["1", "EECS", "COMPUTER SCIENCE", "2", "EECS"]],
  EECS: [COURSE_HEADER, ["EECS 280", "Programming"], ["EECS 281", "Algorithms"]],
};

function setup(overrides: Partial<Parameters<typeof CatalogImport>[0]> = {}) {
  const importBatch = vi.fn(async (_school: string, entries: CatalogRecord[]) => ({
    ok: true as const,
    written: entries.length,
  }));
  const materialize = vi.fn(async () => ({
    status: "success" as const,
    message: "已生成 2026-fall：新建 2 门课程，已存在 0 门。",
  }));
  render(
    <CatalogImport
      importBatch={importBatch}
      materialize={materialize}
      schools={SCHOOLS}
      {...overrides}
    />,
  );
  return { importBatch, materialize };
}

async function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText("官方课表（.xlsx）"), {
    target: { files: [file] },
  });
}

describe("CatalogImport", () => {
  it("先出报告；勾选确认后写入所选学校，再生成当前学期课程", async () => {
    const { importBatch, materialize } = setup();
    fireEvent.change(screen.getByLabelText("写入哪所学校"), {
      target: { value: "umich" },
    });
    await chooseFile(await xlsxFile(EECS_WORKBOOK));

    expect(await screen.findByText(/去重后 2 门课/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "写入 2 门课" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(await screen.findByText(/目录已写入 2 门/)).toBeTruthy();
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect(importBatch.mock.calls[0][0]).toBe("umich");
    expect(importBatch.mock.calls[0][1].map((record) => record.code)).toEqual([
      "EECS 280",
      "EECS 281",
    ]);
    expect(materialize).toHaveBeenCalledWith("umich");
  });

  it("学科缩写撞车时报出来，不能导入", async () => {
    setup();
    await chooseFile(
      await xlsxFile({ Index: [INDEX_HEADER, ["1", "A A E"], ["2", "AAE"]] }),
    );

    expect(await screen.findByText(/必须先在课表里改正才能导入/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });

  it("某一批写入失败时停下，说明已写入多少，不再生成课程", async () => {
    const { materialize } = setup({
      importBatch: vi.fn(async () => ({
        ok: false as const,
        message: "这批数据里有不合格的课（EECS 280），整批没有写入。",
      })),
    });
    await chooseFile(await xlsxFile(EECS_WORKBOOK));
    await screen.findByText(/去重后 2 门课/);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "写入 2 门课" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("写到第 1 门时失败");
    expect(alert.textContent).toContain("已写入 0 门");
    expect(materialize).not.toHaveBeenCalled();
  });

  it("读不了的文件给出提示", async () => {
    setup();
    await chooseFile(new File([new Uint8Array([1, 2, 3])], "broken.xlsx"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/读不了这个文件/);
  });
});
