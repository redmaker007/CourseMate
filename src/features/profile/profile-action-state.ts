import type { ProfileFieldErrors } from "./profile-service";

export type ProfileActionState = {
  status:
    | "idle"
    | "saved"
    | "invalid"
    | "unauthenticated"
    | "temporarily_unavailable";
  message: string;
  fieldErrors?: ProfileFieldErrors;
};

export const initialProfileActionState: ProfileActionState = {
  status: "idle",
  message: "",
};
