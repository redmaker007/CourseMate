import { NextResponse } from "next/server";

import { getCurrentMember } from "@/features/auth/session";
import { isCourseId } from "@/features/courses/course-identifiers";
import {
  getCourseMessagesAfter,
  getCourseMessagesBefore,
} from "@/features/courses/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!member.onboardingComplete) {
    return NextResponse.json({ error: "onboarding_required" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const rawBefore = searchParams.get("before");
  const rawCursor = rawBefore ?? searchParams.get("after") ?? "0";
  if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor))) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const { courseId } = await params;
  if (!isCourseId(courseId)) {
    return NextResponse.json({ error: "invalid_course" }, { status: 400 });
  }
  const result = rawBefore
    ? await getCourseMessagesBefore(member, courseId, Number(rawBefore))
    : await getCourseMessagesAfter(member, courseId, Number(rawCursor));
  if (!result) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(result);
}
