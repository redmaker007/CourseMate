import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseBoundary = vi.hoisted(() => ({
  authUser: {
    id: "user-1",
    email: "student@wisc.edu",
  } as { id: string; email: string } | null,
  incomingCookies: [] as Array<{ name: string; value: string }>,
  memberBinding: {
    user_id: "user-1",
    school_id: "uw-madison",
  } as { user_id: string; school_id: string } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        getAll(): Array<{ name: string; value: string }>;
        setAll(
          cookies: Array<{
            name: string;
            value: string;
            options: Record<string, unknown>;
          }>,
          headers: Record<string, string>,
        ): void;
      };
    },
  ) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: supabaseBoundary.memberBinding,
        error: null,
      }),
    };

    return {
      auth: {
        getUser: async () => {
          supabaseBoundary.incomingCookies = options.cookies.getAll();
          options.cookies.setAll(
            [
              {
                name: "sb-session",
                value: "refreshed-session",
                options: { maxAge: 3600 },
              },
            ],
            {
              "Cache-Control":
                "private, no-cache, no-store, must-revalidate, max-age=0",
              Expires: "0",
              Pragma: "no-cache",
            },
          );
          return {
            data: {
              user: supabaseBoundary.authUser,
            },
            error: null,
          };
        },
      },
      from: () => query,
      rpc: async () => ({ data: "uw-madison", error: null }),
    };
  },
}));

import { proxy } from "./proxy";

describe("proxy member session", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    supabaseBoundary.authUser = {
      id: "user-1",
      email: "student@wisc.edu",
    };
    supabaseBoundary.incomingCookies = [];
    supabaseBoundary.memberBinding = {
      user_id: "user-1",
      school_id: "uw-madison",
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("浏览器重新访问时读取并安全写回刷新的成员会话 Cookie", async () => {
    const request = new NextRequest("https://coursemate.example/courses", {
      headers: { cookie: "sb-session=existing-session" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(supabaseBoundary.incomingCookies).toContainEqual({
      name: "sb-session",
      value: "existing-session",
    });
    expect(response.cookies.get("sb-session")?.value).toBe(
      "refreshed-session",
    );
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("只有 Auth 会话但缺少成员绑定时拒绝受保护访问", async () => {
    supabaseBoundary.memberBinding = null;
    const request = new NextRequest("https://coursemate.example/courses", {
      headers: { cookie: "sb-session=auth-only-session" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://coursemate.example/login?next=%2Fcourses",
    );
    expect(response.cookies.get("sb-session")?.value).toBe(
      "refreshed-session",
    );
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("失效 Supabase 会话不能访问受保护路径", async () => {
    supabaseBoundary.authUser = null;
    supabaseBoundary.memberBinding = null;
    const request = new NextRequest("https://coursemate.example/courses");

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://coursemate.example/login?next=%2Fcourses",
    );
  });
});
