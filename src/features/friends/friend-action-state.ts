import type { FriendDiscovery } from "./friendship-service";

export type FriendSearchState =
  | { status: "idle"; message: "" }
  | { status: "found"; message: string; member: FriendDiscovery }
  | {
      status:
        | "invalid"
        | "not_found"
        | "rate_limited"
        | "onboarding_required"
        | "unauthenticated"
        | "temporarily_unavailable";
      message: string;
    };

export type FriendActionState = {
  status: string;
  message: string;
  fieldErrors?: { message?: string; note?: string };
};

export const initialFriendSearchState: FriendSearchState = {
  status: "idle",
  message: "",
};

export const initialFriendActionState: FriendActionState = {
  status: "idle",
  message: "",
};
