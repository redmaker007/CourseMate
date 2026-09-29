import { NextResponse } from "next/server";

import { getCurrentMember } from "@/features/auth/session";
import { recognizeCourseImage } from "@/features/courses/production-course-image-recognition";

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (!member.onboardingComplete) {
    return NextResponse.json(
      { status: "onboarding_required" },
      { status: 403 },
    );
  }

  let image: FormDataEntryValue | null;
  try {
    image = (await request.formData()).get("image");
  } catch {
    image = null;
  }
  if (!(image instanceof File)) {
    return NextResponse.json({ status: "invalid_image" }, { status: 400 });
  }

  try {
    const result = await recognizeCourseImage(member, image);
    switch (result.status) {
      case "invalid_image":
        return NextResponse.json(result, { status: 400 });
      case "onboarding_required":
        return NextResponse.json(result, { status: 403 });
      case "no_current_term":
        return NextResponse.json(result, { status: 409 });
      case "personal_limit":
      case "global_limit":
        return NextResponse.json(result, {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        });
      case "unavailable":
        return NextResponse.json(result, { status: 503 });
      default:
        return NextResponse.json(result);
    }
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
