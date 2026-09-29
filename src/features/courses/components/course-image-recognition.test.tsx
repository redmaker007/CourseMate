// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseImageRecognition } from "./course-image-recognition";

describe("CourseImageRecognition", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("展示未勾选候选，并在关闭后立即丢弃结果", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "recognized",
        candidates: [
          {
            courseId: "course-1",
            code: "CS 540",
            title: "Artificial Intelligence",
            matchedBy: "code",
            context: "uncertain",
            confidence: "medium",
            defaultSelected: false,
          },
        ],
      }),
    } as Response);
    render(<CourseImageRecognition />);

    const input = screen.getByLabelText("选课页面图片");
    fireEvent.change(input, {
      target: {
        files: [new File(["image"], "courses.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "识别课程" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const close = screen.getByRole("button", { name: "关闭识别结果" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    expect(screen.getByText("CS 540")).toBeTruthy();
    expect(screen.getByText("可能的课程")).toBeTruthy();
    const candidate = screen.getByRole("checkbox", { name: /CS 540/ });
    expect(candidate).toHaveProperty("checked", false);
    expect(candidate).toHaveProperty("disabled", true);

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("八秒提示较慢，十二秒终止等待并允许重试", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    render(<CourseImageRecognition />);
    fireEvent.change(screen.getByLabelText("选课页面图片"), {
      target: {
        files: [new File(["image"], "courses.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "识别课程" }));

    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(screen.getByText("识别时间比平时更长，请稍候。")).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(screen.getByText("识别服务暂时不可用，请稍后重试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "识别课程" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("客户端拒绝非标准格式，不发送请求", () => {
    render(<CourseImageRecognition />);
    fireEvent.change(screen.getByLabelText("选课页面图片"), {
      target: {
        files: [new File(["image"], "courses.heic", { type: "image/heic" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "识别课程" }));

    expect(screen.getByText(/无法读取这张图片/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
