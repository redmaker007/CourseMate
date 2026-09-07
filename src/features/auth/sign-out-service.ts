export type SignOutResult =
  | { status: "signed_out" }
  | { status: "temporarily_unavailable" };

export interface CurrentDeviceSessionPort {
  signOut(): Promise<void>;
}

export function createSignOutService(session: CurrentDeviceSessionPort) {
  return {
    async signOutCurrentDevice(): Promise<SignOutResult> {
      try {
        await session.signOut();
        return { status: "signed_out" };
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}
