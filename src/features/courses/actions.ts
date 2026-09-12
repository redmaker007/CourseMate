"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { CourseMessageActionState } from "./course-action-state";
import { isUuid } from "./course-identifiers";
import { createProductionCourseOperations } from "./production-course-operations";

export async function joinCourseAction(courseId: string) {
  if (!isUuid(courseId)) redirect("/dashboard?courseAction=invalid");
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof createProductionCourseOperations>>["joinCourse"]>>;
  try {
    const operations = await createProductionCourseOperations();
    result = await operations.joinCourse(courseId);
  } catch {
    redirect("/dashboard?courseAction=failed");
  }
  if (result.status !== "joined") {
    redirect("/dashboard?courseAction=failed");
  }
  revalidatePath("/dashboard");
  redirect(`/courses/${courseId}`);
}

export async function leaveCourseAction(courseId: string) {
  if (!isUuid(courseId)) redirect("/dashboard?courseAction=invalid");
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof createProductionCourseOperations>>["leaveCourse"]>>;
  try {
    const operations = await createProductionCourseOperations();
    result = await operations.leaveCourse(courseId);
  } catch {
    redirect(`/courses/${courseId}?courseAction=failed`);
  }
  if (result.status !== "left") {
    redirect(`/courses/${courseId}?courseAction=failed`);
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function sendCourseMessageAction(
  _previousState: CourseMessageActionState,
  formData: FormData,
): Promise<CourseMessageActionState> {
  const courseId = formData.get("courseId");
  const conversationId = formData.get("conversationId");
  const clientMessageId = formData.get("clientMessageId");
  const attemptedBody = String(formData.get("body") ?? "");
  const attempt = {
    clientMessageId: String(clientMessageId ?? ""),
    attemptedBody,
  };
  if (
    !isUuid(courseId) ||
    !isUuid(conversationId) ||
    !isUuid(clientMessageId)
  ) {
    return {
      status: "invalid",
      message: "课程信息无效，请刷新页面。",
      ...attempt,
    };
  }

  let result: Awaited<ReturnType<Awaited<ReturnType<typeof createProductionCourseOperations>>["sendCourseMessage"]>>;
  try {
    const operations = await createProductionCourseOperations();
    result = await operations.sendCourseMessage(
      conversationId,
      clientMessageId,
      attemptedBody,
    );
  } catch {
    return {
      status: "unavailable",
      message: "消息暂时无法发送。",
      ...attempt,
    };
  }
  switch (result.status) {
    case "sent":
      revalidatePath(`/courses/${courseId}`);
      return {
        status: "sent",
        message: "消息已发送。",
        ...attempt,
        savedMessage: result.message,
      };
    case "invalid":
      return {
        status: "invalid",
        message: "请输入 1–4000 个字符。",
        ...attempt,
      };
    case "unauthenticated":
    case "not_available":
    case "temporarily_unavailable":
      return {
        status: "unavailable",
        message: "消息暂时无法发送。",
        ...attempt,
      };
  }
}
