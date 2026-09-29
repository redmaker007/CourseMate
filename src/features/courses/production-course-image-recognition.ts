import "server-only";

import type { CurrentMember } from "@/features/auth/session";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { createCourseImageRecognizer } from "./course-image-recognition";
import type { CourseCatalogEntry } from "./course-service";

type QuotaRow = {
  result_status: string;
  retry_after_seconds: number;
};

type VisionResponse = {
  responses?: Array<{
    error?: { message?: string };
    fullTextAnnotation?: { text?: string };
    textAnnotations?: Array<{ description?: string }>;
  }>;
};

export async function recognizeCourseImage(member: CurrentMember, file: File) {
  const supabase = await createClient();
  const recognize = createCourseImageRecognizer({
    async loadCurrentCourses(currentMember) {
      const { data: setting, error: termError } = await supabase
        .from("school_term_settings")
        .select("current_term")
        .eq("school_id", currentMember.schoolId)
        .maybeSingle();
      if (termError) throw termError;
      if (!setting?.current_term) return null;

      const courses: CourseCatalogEntry[] = [];
      const pageSize = 1_000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("courses")
          .select("id, school_id, code, title, term")
          .eq("school_id", currentMember.schoolId)
          .eq("term", setting.current_term)
          .order("code_normalized")
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = data ?? [];
        courses.push(
          ...rows.map((course) => ({
            id: course.id,
            schoolId: course.school_id,
            code: course.code,
            title: course.title,
            term: course.term,
          })),
        );
        if (rows.length < pageSize) {
          return { term: setting.current_term, courses };
        }
      }
    },
    async consumeQuota() {
      const invoke = supabase.rpc.bind(supabase) as unknown as (
        name: "consume_course_recognition_quota",
      ) => Promise<{ data: QuotaRow[] | null; error: { message: string } | null }>;
      const { data, error } = await invoke("consume_course_recognition_quota");
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("课程识别额度没有返回结果");
      if (
        row.result_status !== "allowed" &&
        row.result_status !== "personal_limit" &&
        row.result_status !== "global_limit" &&
        row.result_status !== "onboarding_required"
      ) {
        throw new Error("课程识别额度返回了未知状态");
      }
      return {
        status: row.result_status,
        retryAfterSeconds: row.retry_after_seconds,
      };
    },
    async detectText({ bytes }) {
      const response = await fetch(
        "https://vision.googleapis.com/v1/images:annotate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": env.googleCloudVisionApiKey,
          },
          body: JSON.stringify({
            requests: [
              {
                image: { content: bytes.toString("base64") },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
                imageContext: { languageHints: ["en"] },
              },
            ],
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!response.ok) throw new Error("Google Vision 请求失败");
      const payload = (await response.json()) as VisionResponse;
      const result = payload.responses?.[0];
      if (!result || result.error) throw new Error("Google Vision 识别失败");
      return (
        result.fullTextAnnotation?.text ??
        result.textAnnotations?.[0]?.description ??
        ""
      );
    },
  });

  return recognize(member, file);
}
