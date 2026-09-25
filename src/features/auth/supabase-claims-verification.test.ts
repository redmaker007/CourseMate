import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createSupabaseMemberSessionReader } from "./supabase-email-otp-adapters";

/**
 * 用真实的 @supabase/auth-js 与真实的 ES256 签名验证「本地验签」这条安全边界：
 * 合法令牌被接受、被篡改或伪造的令牌被拒绝、且校验路径从不向 Auth 服务器
 * 调用 /auth/v1/user。网络用可记录的假 fetch 代替，因此不依赖任何真实项目。
 */

const KID = "test-key-1";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const VICTIM_ID = "22222222-2222-4222-8222-222222222222";
const ROW = {
  user_id: USER_ID,
  home_school_id: "uw-madison",
  enabled_school_id: "uw-madison",
  current_school_id: "uw-madison",
  onboarding_complete: true,
};

let trusted: CryptoKeyPair;
let attacker: CryptoKeyPair;
let trustedJwk: JsonWebKey;
let projectCounter = 0;

const encode = (input: string | Uint8Array) =>
  Buffer.from(typeof input === "string" ? input : input).toString("base64url");

async function generatePair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://example.supabase.co/auth/v1",
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    sub: USER_ID,
    email: "student@wisc.edu",
    role: "authenticated",
    aal: "aal1",
    session_id: "33333333-3333-4333-8333-333333333333",
    is_anonymous: false,
    ...overrides,
  };
}

async function signToken(
  payload: Record<string, unknown>,
  {
    key = trusted.privateKey,
    header = { alg: "ES256", typ: "JWT", kid: KID },
  }: { key?: CryptoKey; header?: Record<string, unknown> } = {},
) {
  const head = encode(JSON.stringify(header));
  const body = encode(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(`${head}.${body}`),
    ),
  );
  return `${head}.${body}.${encode(signature)}`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fakeNetwork({ userEndpoint = "reject" as "reject" | "accept" } = {}) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);

    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      return json({ keys: [{ ...trustedJwk, kid: KID, alg: "ES256", use: "sig" }] });
    }
    if (url.pathname === "/rest/v1/rpc/get_member_context") return json([ROW]);
    if (url.pathname === "/auth/v1/user") {
      return userEndpoint === "accept"
        ? json({ id: USER_ID, aud: "authenticated", email: "student@wisc.edu" })
        : json({ code: 401, error_code: "bad_jwt", msg: "invalid claim" }, 401);
    }
    if (url.pathname === "/auth/v1/token") {
      return json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }, 400);
    }
    return json({ code: 500, msg: `unexpected request: ${url.pathname}` }, 500);
  };
  return { calls, fetchImpl };
}

// 每个测试用独立的项目域名：公钥缓存按存储键全局共享，共用会互相影响。
function newProject() {
  projectCounter += 1;
  const name = `project${projectCounter}`;
  return { url: `https://${name}.supabase.co`, storageKey: `sb-${name}-auth-token` };
}

function clientFor(
  project: ReturnType<typeof newProject>,
  network: ReturnType<typeof fakeNetwork>,
  session: { accessToken: string; expiresAt: number } | null,
) {
  const store = new Map<string, string>();
  if (session) {
    store.set(
      project.storageKey,
      JSON.stringify({
        access_token: session.accessToken,
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: session.expiresAt,
        user: {
          id: USER_ID,
          aud: "authenticated",
          email: "student@wisc.edu",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    );
  }

  return createClient(project.url, "anon-key", {
    auth: {
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: network.fetchImpl },
  });
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

async function sessionFor(token: string, network: ReturnType<typeof fakeNetwork>, project = newProject()) {
  const client = clientFor(project, network, {
    accessToken: token,
    expiresAt: inOneHour(),
  });
  return createSupabaseMemberSessionReader(client).getMemberSession();
}

beforeAll(async () => {
  trusted = await generatePair();
  attacker = await generatePair();
  trustedJwk = await crypto.subtle.exportKey("jwk", trusted.publicKey);
});

describe("本地验签的成员会话", () => {
  it("合法令牌在本地通过验证，且从不调用 /auth/v1/user", async () => {
    const network = fakeNetwork();
    const token = await signToken(claims());

    await expect(sessionFor(token, network)).resolves.toEqual({
      userId: USER_ID,
      schoolId: "uw-madison",
    });

    expect(network.calls).toEqual([
      "GET /auth/v1/.well-known/jwks.json",
      "POST /rest/v1/rpc/get_member_context",
    ]);
  });

  it("公钥会被缓存：同一项目再建客户端不会再次拉取", async () => {
    const network = fakeNetwork();
    const project = newProject();
    const token = await signToken(claims());

    await sessionFor(token, network, project);
    await sessionFor(token, network, project);

    const jwksFetches = network.calls.filter((call) => call.includes("jwks.json"));
    expect(jwksFetches).toHaveLength(1);
    expect(network.calls.filter((call) => call.includes("get_member_context"))).toHaveLength(2);
    expect(network.calls.some((call) => call.includes("/auth/v1/user"))).toBe(false);
  });

  it("没有会话时不产生任何网络请求", async () => {
    const network = fakeNetwork();
    const client = clientFor(newProject(), network, null);

    await expect(
      createSupabaseMemberSessionReader(client).getMemberSession(),
    ).resolves.toBeNull();
    expect(network.calls).toEqual([]);
  });

  it("篡改令牌内容（改成别人的身份）但沿用原签名：拒绝，且不访问数据库", async () => {
    const network = fakeNetwork();
    const genuine = await signToken(claims());
    const [head, , signature] = genuine.split(".");
    const forgedBody = encode(
      JSON.stringify(claims({ sub: VICTIM_ID, email: "victim@wisc.edu" })),
    );

    await expect(
      sessionFor(`${head}.${forgedBody}.${signature}`, network),
    ).rejects.toThrow("Invalid JWT signature");
    expect(network.calls.some((call) => call.includes("get_member_context"))).toBe(false);
  });

  it("用攻击者自己的密钥签发、冒用同一个 kid：拒绝，且不访问数据库", async () => {
    const network = fakeNetwork();
    const forged = await signToken(claims({ sub: VICTIM_ID }), {
      key: attacker.privateKey,
    });

    await expect(sessionFor(forged, network)).rejects.toThrow("Invalid JWT signature");
    expect(network.calls.some((call) => call.includes("get_member_context"))).toBe(false);
  });

  it("alg 为 none 的伪造令牌：拒绝，且不访问数据库", async () => {
    const network = fakeNetwork();
    const head = encode(JSON.stringify({ alg: "none", typ: "JWT", kid: KID }));
    const body = encode(JSON.stringify(claims({ sub: VICTIM_ID })));

    await expect(sessionFor(`${head}.${body}.`, network)).rejects.toThrow();
    expect(network.calls.some((call) => call.includes("get_member_context"))).toBe(false);
  });

  it("令牌已过期且无法刷新：拒绝，且不访问数据库", async () => {
    const network = fakeNetwork();
    const expired = await signToken(
      claims({ exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    const client = clientFor(newProject(), network, {
      accessToken: expired,
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });

    await expect(
      createSupabaseMemberSessionReader(client).getMemberSession(),
    ).rejects.toThrow();
    expect(network.calls.some((call) => call.includes("get_member_context"))).toBe(false);
  });

  it("未知的 kid 不在本地信任，退回向 Auth 服务器确认；服务器拒绝就拒绝", async () => {
    const network = fakeNetwork({ userEndpoint: "reject" });
    const token = await signToken(claims(), {
      header: { alg: "ES256", typ: "JWT", kid: "unknown-key" },
    });

    await expect(sessionFor(token, network)).rejects.toThrow();
    expect(network.calls).toContain("GET /auth/v1/user");
    expect(network.calls.some((call) => call.includes("get_member_context"))).toBe(false);
  });

  it("旧式对称签名（HS256）不在本地信任，退回向 Auth 服务器确认", async () => {
    const forged = `${encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${encode(
      JSON.stringify(claims({ sub: VICTIM_ID })),
    )}.${encode("not-a-real-signature")}`;

    const rejecting = fakeNetwork({ userEndpoint: "reject" });
    await expect(sessionFor(forged, rejecting)).rejects.toThrow();
    expect(rejecting.calls).toContain("GET /auth/v1/user");
    expect(rejecting.calls.some((call) => call.includes("get_member_context"))).toBe(false);

    // 服务器确认有效时才放行，等同于改动之前的行为。
    const accepting = fakeNetwork({ userEndpoint: "accept" });
    const genuine = `${encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${encode(
      JSON.stringify(claims()),
    )}.${encode("signature-checked-by-server")}`;
    await expect(sessionFor(genuine, accepting)).resolves.toEqual({
      userId: USER_ID,
      schoolId: "uw-madison",
    });
    expect(accepting.calls).toContain("GET /auth/v1/user");
  });

  it("令牌有效，但数据库里已经没有这个成员（例如用户被删除）时立即视为未登录", async () => {
    const network = fakeNetwork();
    const project = newProject();
    const token = await signToken(claims());
    const originalFetch = network.fetchImpl;
    network.fetchImpl = async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.pathname === "/rest/v1/rpc/get_member_context") {
        network.calls.push("POST /rest/v1/rpc/get_member_context");
        return json([]);
      }
      return originalFetch(input, init);
    };

    await expect(sessionFor(token, network, project)).resolves.toBeNull();
  });
});
