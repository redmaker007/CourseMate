export type DirectMessageActionState = {
  status: string;
  message: string;
  messageId?: string;
  throughMessageId?: string;
};

export const initialDirectMessageActionState: DirectMessageActionState = {
  status: "idle",
  message: "",
};
