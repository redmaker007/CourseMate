import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(supabase),
}));

import { getOwnProfile } from "./queries";

describe("profile queries", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
  });

  it("loads the authenticated member's complete Profile through the restricted RPC", async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          display_name: "Alice",
          major: "Computer Science",
          grad_year: 2027,
          avatar_url: null,
        },
      ],
      error: null,
    });

    await expect(
      getOwnProfile("11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual({
      displayName: "Alice",
      major: "Computer Science",
      gradYear: 2027,
      avatarUrl: null,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("get_own_profile");
  });
});
