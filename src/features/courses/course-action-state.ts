import type { SyncedCourseMessage } from "./message-sync";

export type CourseMessageActionState = {
  status: "idle" | "sent" | "invalid" | "unavailable";
  message: string;
  savedMessage?: SyncedCourseMessage;
};

export const initialCourseMessageActionState: CourseMessageActionState = {
  status: "idle",
  message: "",
};
