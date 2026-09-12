import type { DirectMessage } from "./direct-message-service";

export type DirectMessageActionState = {
  status: string;
  message: string;
  clientMessageId?: string;
  attemptedBody?: string;
  savedMessage?: DirectMessage;
  throughMessageId?: string;
};

export const initialDirectMessageActionState: DirectMessageActionState = {
  status: "idle",
  message: "",
};
