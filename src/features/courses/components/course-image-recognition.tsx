"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import {
  requestCourseImageRecognition,
  type CourseImageCandidate,
} from "../course-image-recognition-client";

type DialogState = {
  candidates: CourseImageCandidate[];
  message?: string;
};

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function errorMessage(status: string, retryAfterSeconds?: number) {
  switch (status) {
    case "invalid_image":
      return "无法读取这张图片，请选择不超过 3 MB 的 JPEG、PNG 或 WebP。";
    case "no_current_term":
      return "当前学校还没有设置可识别的学期。";
    case "personal_limit":
      return `操作过于频繁，请约 ${Math.max(1, Math.ceil((retryAfterSeconds ?? 60) / 60))} 分钟后重试。`;
    case "global_limit":
      return "本月课程识别额度已用完。";
    case "onboarding_required":
    case "unauthorized":
      return "登录状态已失效，请重新登录。";
    default:
      return "识别服务暂时不可用，请稍后重试。";
  }
}

export function CourseImageRecognition() {
  const [file, setFile] = useState<File | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialog) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialog(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        submitButton.current?.focus();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialog]);

  function closeDialog() {
    setDialog(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    submitButton.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!file || !ALLOWED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setError(errorMessage("invalid_image"));
      return;
    }

    setLoading(true);
    setSlow(false);
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => setSlow(true), 8_000);
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await requestCourseImageRecognition(
        file,
        controller.signal,
      );
      if (result.status === "recognized") {
        setDialog({ candidates: result.candidates ?? [] });
      } else if (result.status === "no_text") {
        setDialog({ candidates: [], message: "图片中没有识别到清晰文字。" });
      } else if (result.status === "no_candidates") {
        setDialog({
          candidates: [],
          message: "没有匹配到当前学校本学期的课程。",
        });
      } else {
        setError(errorMessage(result.status, result.retryAfterSeconds));
      }
    } catch {
      setError("识别服务暂时不可用，请稍后重试。");
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
      setLoading(false);
      setSlow(false);
    }
  }

  return (
    <>
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-lg font-semibold text-slate-950">扫描选课页面</h2>
        <p className="mt-1 text-sm text-slate-600">
          上传 JPEG、PNG 或 WebP，识别结果关闭后不会保存。
        </p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            选课页面图片
            <input
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:font-medium file:text-indigo-700"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              ref={fileInput}
              type="file"
            />
          </label>
          <button
            className="self-end rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={loading}
            ref={submitButton}
            type="submit"
          >
            {loading ? "正在识别…" : "识别课程"}
          </button>
        </form>
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {slow ? <p className="text-amber-700">识别时间比平时更长，请稍候。</p> : null}
          {error ? <p className="text-rose-700">{error}</p> : null}
        </div>
      </div>

      {dialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm">
          <div
            aria-labelledby="course-recognition-title"
            aria-modal="true"
            className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-xl font-semibold text-slate-950"
                  id="course-recognition-title"
                >
                  识别出的课程
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  当前结果仅供核对，暂时不会加入课程。
                </p>
              </div>
              <button
                aria-label="关闭识别结果"
                className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100"
                onClick={closeDialog}
                ref={closeButton}
                type="button"
              >
                ×
              </button>
            </div>

            {dialog.message ? (
              <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-700">
                {dialog.message}
              </p>
            ) : (
              <ul className="mt-5 space-y-3">
                {dialog.candidates.map((candidate) => (
                  <li
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                    key={candidate.courseId}
                  >
                    <label className="flex items-start gap-3 text-slate-950">
                      <input
                        aria-label={`${candidate.code} ${candidate.title}`}
                        className="mt-1"
                        defaultChecked={candidate.defaultSelected}
                        disabled
                        type="checkbox"
                      />
                      <span>
                        <span className="block font-semibold">{candidate.code}</span>
                        <span className="block text-sm text-slate-600">
                          {candidate.title}
                        </span>
                        <span className="mt-1 block text-xs text-amber-700">
                          可能的课程
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
