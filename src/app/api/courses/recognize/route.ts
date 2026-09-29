import { NextResponse } from "next/server";

import { getCurrentMember } from "@/features/auth/session";
import { recognizeCourseImage } from "@/features/courses/production-course-image-recognition";

const MAX_REQUEST_BYTES = 3 * 1024 * 1024 + 64 * 1024;

async function readBoundedFormData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (
      !Number.isFinite(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > MAX_REQUEST_BYTES
    ) {
      return null;
    }
  }
  if (!request.body) return null;

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": contentType },
  }).formData();
}

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
    image = (await readBoundedFormData(request))?.get("image") ?? null;
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
