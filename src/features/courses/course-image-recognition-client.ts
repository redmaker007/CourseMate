export type CourseImageCandidate = {
  courseId: string;
  code: string;
  title: string;
  context: "uncertain";
  defaultSelected: false;
};

export async function requestCourseImageRecognition(
  file: File,
  signal: AbortSignal,
) {
  const body = new FormData();
  body.set("image", file);
  const response = await fetch("/api/courses/recognize", {
    method: "POST",
    body,
    signal,
  });
  return (await response.json()) as {
    status: string;
    candidates?: CourseImageCandidate[];
    retryAfterSeconds?: number;
  };
}
