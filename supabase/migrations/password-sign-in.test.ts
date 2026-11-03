import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * 密码登录与 30 天重新验证（202610270001，ADR-0011）。
 *
 * 会话的登录方式来自 JWT 的 amr，这里用 request.jwt.claims 模拟 PostgREST 传入的声明。
 * auth.users 替身带 encrypted_password 和 last_sign_in_at，其他测试的替身没有这两列。
 */

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const LEGACY = "c3333333-3333-4333-8333-333333333333";
const MIGRATION = "202610270001_password_sign_in.sql";
let db: PGlite;

type Amr = { method: string; secondsAgo: number }[];

async function as(user: string | null, amr: Amr, sql: string) {
  const now = Math.floor(Date.now() / 1000);
  const claims = JSON.stringify({ sub: user, amr: amr.map(({ method, secondsAgo }) => ({ method, timestamp: now - secondsAgo })) });
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ""}', false);
    select set_config('request.jwt.claims', '${claims}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null }; }
  catch (error) { return { rows: [], error: (error as Error).message.split("\n")[0] }; }
  finally { await db.exec("reset role"); }
}
const OTP_NOW: Amr = [{ method: "otp", secondsAgo: 5 }];
const PASSWORD_NOW: Amr = [{ method: "password", secondsAgo: 5 }];
const reverify = async (user: string, amr: Amr) =>
  (await as(user, amr, "select reverification_required from public.get_member_context('wisc.edu')")).rows[0]?.reverification_required;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text unique, email_confirmed_at timestamptz,
      encrypted_password text, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create publication supabase_realtime; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const files = (await readdir(resolve(process.cwd(), "supabase/migrations"))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    // 迁移前已有的成员，用来验证回填。
    if (file === MIGRATION) {
      await db.exec(`insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
        values ('${LEGACY}','legacy@wisc.edu',now()-interval '60 days',now()-interval '40 days')`);
    }
    await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", file), "utf8"));
  }
});
beforeEach(async () => {
  await db.exec(`delete from auth.users where id in ('${ALICE}','${BOB}');
    insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
      ('${ALICE}','alice@wisc.edu',now(),'random-otp-hash'),('${BOB}','bob@wisc.edu',now(),'random-otp-hash');`);
});
afterAll(async () => { await db?.close(); });

describe("验证码时间记录与 30 天规则", () => {
  it("迁移前的成员按最近登录时间回填，超过 30 天的直接要求重新验证", async () => {
    const [row] = (await db.query<{ days: number }>(`select extract(day from now()-email_verified_at)::int as days
      from public.member_auth_state where user_id='${LEGACY}'`)).rows;
    expect(row.days).toBe(40);
    expect(await reverify(LEGACY, [])).toBe(true);
  });

  it("只有 10 分钟内的验证码会话能登记验证时间，密码会话和过期 otp 都不行", async () => {
    expect((await as(ALICE, [], "select public.record_email_verification()")).error).toBe("recent_email_verification_required");
    expect((await as(ALICE, PASSWORD_NOW, "select public.record_email_verification()")).error).toBe("recent_email_verification_required");
    expect((await as(ALICE, [{ method: "otp", secondsAgo: 11 * 60 }], "select public.record_email_verification()")).error).toBe("recent_email_verification_required");
    expect((await as(ALICE, OTP_NOW, "select public.record_email_verification() as status")).rows).toEqual([{ status: "recorded" }]);
  });

  it("验证码会话自身就算验证过；超过 30 天的旧验证码会话要求重新验证", async () => {
    expect(await reverify(ALICE, OTP_NOW)).toBe(false);
    expect(await reverify(ALICE, [{ method: "otp", secondsAgo: 31 * 86400 }])).toBe(true);
  });

  it("按账号计：一处验证码登录后，同账号的其他会话也续上 30 天", async () => {
    await db.exec(`update public.member_auth_state set email_verified_at=now()-interval '31 days' where user_id='${LEGACY}'`);
    expect(await reverify(LEGACY, [{ method: "otp", secondsAgo: 31 * 86400 }])).toBe(true);
    await as(LEGACY, OTP_NOW, "select public.record_email_verification()");
    expect(await reverify(LEGACY, [{ method: "otp", secondsAgo: 31 * 86400 }])).toBe(false);
  });
});

describe("密码只认经本应用流程设置的", () => {
  it("没登记过的密码会话要求重新验证；登记后放行；绕过流程改密码后又失效", async () => {
    await as(ALICE, OTP_NOW, "select public.record_email_verification()");
    expect(await reverify(ALICE, PASSWORD_NOW)).toBe(true);
    expect((await as(ALICE, OTP_NOW, "select public.own_password_status() as set")).rows).toEqual([{ set: false }]);

    await db.exec(`update auth.users set encrypted_password='hash-set-by-alice' where id='${ALICE}'`);
    expect((await as(ALICE, OTP_NOW, "select public.record_password_set() as status")).rows).toEqual([{ status: "recorded" }]);
    expect(await reverify(ALICE, PASSWORD_NOW)).toBe(false);
    expect((await as(ALICE, PASSWORD_NOW, "select public.own_password_status() as set")).rows).toEqual([{ set: true }]);

    await db.exec(`update auth.users set encrypted_password='hash-set-elsewhere' where id='${ALICE}'`);
    expect(await reverify(ALICE, PASSWORD_NOW)).toBe(true);
    expect((await as(ALICE, PASSWORD_NOW, "select public.own_password_status() as set")).rows).toEqual([{ set: false }]);
  });

  it("登记密码同样要求 10 分钟内的验证码会话", async () => {
    expect((await as(BOB, PASSWORD_NOW, "select public.record_password_set()")).error).toBe("recent_email_verification_required");
    expect((await as(BOB, [{ method: "otp", secondsAgo: 11 * 60 }], "select public.record_password_set()")).error).toBe("recent_email_verification_required");
  });

  it("密码会话超过 30 天没验证码同样要重新验证", async () => {
    await db.exec(`update auth.users set encrypted_password='hash-bob' where id='${BOB}'`);
    await as(BOB, OTP_NOW, "select public.record_password_set()");
    await db.exec(`update public.member_auth_state set email_verified_at=now()-interval '31 days' where user_id='${BOB}'`);
    expect(await reverify(BOB, PASSWORD_NOW)).toBe(true);
  });

  it("首次确认邮箱时清掉之前设的密码，之后改密码不受影响", async () => {
    const ID = "d4444444-4444-4444-8444-444444444444";
    await db.exec(`insert into auth.users(id,email,encrypted_password) values ('${ID}','victim@wisc.edu','attacker-hash')`);
    await db.exec(`update auth.users set email_confirmed_at=now() where id='${ID}'`);
    expect((await db.query(`select encrypted_password from auth.users where id='${ID}'`)).rows).toEqual([{ encrypted_password: "" }]);
    await db.exec(`update auth.users set encrypted_password='owner-hash' where id='${ID}'`);
    expect((await db.query(`select encrypted_password from auth.users where id='${ID}'`)).rows).toEqual([{ encrypted_password: "owner-hash" }]);
    // 已确认的账号再次验码时 Auth 可能重写确认时间，不能清掉本人设的密码。
    await db.exec(`update auth.users set email_confirmed_at=now() where id='${ID}'`);
    expect((await db.query(`select encrypted_password from auth.users where id='${ID}'`)).rows).toEqual([{ encrypted_password: "owner-hash" }]);
    await db.exec(`delete from auth.users where id='${ID}'`);
  });
});

describe("权限", () => {
  it("客户端读不到 member_auth_state，内部函数不对登录用户开放", async () => {
    expect((await as(ALICE, OTP_NOW, "select * from public.member_auth_state")).error).toBe("permission denied for table member_auth_state");
    expect((await as(ALICE, OTP_NOW, "select public.session_email_otp_at()")).error).toBe("permission denied for function session_email_otp_at");
    const [privilege] = (await db.query(`select
      has_function_privilege('anon','public.record_email_verification()','execute') as anon_record,
      has_function_privilege('anon','public.get_member_context(text)','execute') as anon_context,
      has_function_privilege('authenticated','public.record_password_set()','execute') as user_password`)).rows;
    expect(privilege).toEqual({ anon_record: false, anon_context: false, user_password: true });
  });

  it("注销账号时状态随成员一起删除", async () => {
    await as(ALICE, OTP_NOW, "select public.record_email_verification()");
    await db.exec(`delete from public.member_accounts where user_id='${ALICE}'`);
    expect((await db.query(`select count(*)::int as n from public.member_auth_state where user_id='${ALICE}'`)).rows).toEqual([{ n: 0 }]);
  });
});
