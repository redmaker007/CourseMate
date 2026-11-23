import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 停用账号（202611230001）。完整迁移链 + 简化 Auth fixture：
 * 停用后主应用全部关闭、资料不能改、已发内容保留；管理员权限边界；
 * 注销后邮箱哈希仍阻止重新注册，按邮箱解除后恢复；解除停用恢复访问。
 */

const OWNER = "f1111111-1111-4111-8111-111111111111";
const ADMIN = "f2222222-2222-4222-8222-222222222222";
const ADMIN_TWO = "f3333333-3333-4333-8333-333333333333";
const BOB = "f4444444-4444-4444-8444-444444444444";
const CAROL = "f5555555-5555-4555-8555-555555555555";

type Result = { rows: Record<string, unknown>[]; error: string | null };
let db: PGlite;
let courseId = "";
let conversationId = "";
let bobMessageId = "";

async function asRole(role: "authenticated" | "service_role" | "supabase_auth_admin", sql: string, user = ""): Promise<Result> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
  try {
    return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null };
  } catch (error) {
    return { rows: [], error: (error as Error).message.split("\n")[0] };
  } finally {
    await db.exec("reset role");
  }
}
const asUser = (user: string, sql: string) => asRole("authenticated", sql, user);
const context = async (user: string, domain = "wisc.edu") =>
  (await asUser(user, `select * from public.get_member_context('${domain}')`)).rows[0];
const hook = async (email: string) =>
  (await asRole("supabase_auth_admin", `select public.hook_restrict_user_to_enabled_school('{"user":{"email":"${email}"}}'::jsonb) as result`)).rows[0]?.result;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text unique, email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
    create table auth.identities(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
    create table auth.refresh_tokens(id serial primary key, user_id text, session_id uuid references auth.sessions(id) on delete cascade);
    create table auth.audit_log_entries(id uuid primary key default gen_random_uuid(), payload json);
    create schema storage; create table storage.objects(id uuid primary key, owner_id text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
    create publication supabase_realtime; grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const migrations = (await readdir(resolve(process.cwd(), "supabase/migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const file of migrations) {
    await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", file), "utf8"));
  }
  await db.exec(`
    insert into auth.users values
      ('${OWNER}', 'owner@wisc.edu', now()), ('${ADMIN}', 'admin@wisc.edu', now()),
      ('${ADMIN_TWO}', 'admin2@wisc.edu', now()), ('${BOB}', 'Bob@wisc.edu', now()), ('${CAROL}', 'carol@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${OWNER}', 'Owner'), ('${ADMIN}', 'Admin'), ('${ADMIN_TWO}', 'Admin2'), ('${BOB}', 'Bob'), ('${CAROL}', 'Carol');
    insert into public.platform_roles (user_id, role) values ('${OWNER}', 'owner'), ('${ADMIN}', 'admin'), ('${ADMIN_TWO}', 'admin');
    insert into public.courses (school_id, code, title, term) values ('uw-madison', 'SUS 100', 'Suspension', '2026-fall');
    insert into auth.sessions values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BOB}');
    insert into auth.refresh_tokens (user_id, session_id) values ('${BOB}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  `);
  courseId = (await db.query<{ id: string }>("select id::text from public.courses where code = 'SUS 100'")).rows[0].id;
  for (const user of [BOB, CAROL]) {
    const joined = await asUser(user, `insert into public.course_members (course_id) values ('${courseId}')`);
    if (joined.error) throw new Error(joined.error);
  }
  conversationId = (await db.query<{ id: string }>(
    `select conversation_id::text as id from public.course_conversations where course_id = '${courseId}'`,
  )).rows[0].id;
  const sent = await asUser(BOB, `select message_id::text from public.send_conversation_message('${conversationId}', 'bob before suspension', gen_random_uuid())`);
  bobMessageId = String(sent.rows[0].message_id);
});

afterAll(async () => {
  await db?.close();
});

describe("停用账号：完整迁移链与真实权限", () => {
  it("只有平台管理员能停用；不能停用自己、所有者，管理员之间只有所有者能停用", async () => {
    expect((await asUser(CAROL, `select public.admin_suspend_member('${BOB}', 'x')`)).error).toMatch(/没有权限/);
    const call = (actor: string, target: string) =>
      asUser(actor, `select public.admin_suspend_member('${target}', null) as status`).then((result) => result.rows[0]?.status);
    expect(await call(ADMIN, ADMIN)).toBe("invalid_target");
    expect(await call(ADMIN, OWNER)).toBe("not_allowed");
    expect(await call(ADMIN, ADMIN_TWO)).toBe("not_allowed");
    expect(await call(ADMIN, "99999999-9999-4999-8999-999999999999")).toBe("not_found");
    expect((await db.query("select count(*)::int as count from public.member_suspensions")).rows).toEqual([{ count: 0 }]);
  });

  it("停用后成员上下文标记 suspended，主应用全部关闭，资料不能改，会话被撤销", async () => {
    const before = await context(BOB);
    expect(before).toMatchObject({ onboarding_complete: true, current_school_id: "uw-madison", suspended: false });

    const suspended = await asUser(ADMIN, `select public.admin_suspend_member('${BOB}', ' 多次骚扰 ') as status`);
    expect(suspended.rows).toEqual([{ status: "suspended" }]);
    expect((await db.query(`select count(*)::int as count from auth.sessions where user_id = '${BOB}'`)).rows).toEqual([{ count: 0 }]);
    expect((await db.query(`select count(*)::int as count from auth.refresh_tokens where user_id = '${BOB}'`)).rows).toEqual([{ count: 0 }]);
    expect((await db.query(`select action, target, details from public.admin_audit_log where action = 'member.suspend'`)).rows)
      .toEqual([{ action: "member.suspend", target: BOB, details: { reason: "多次骚扰" } }]);
    // 停用记录只存邮箱哈希（大小写不敏感），不存邮箱。
    const stored = await db.query<{ email_hash: string }>("select email_hash from public.member_suspensions");
    expect(stored.rows[0].email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toContain("wisc.edu");

    expect(await context(BOB)).toMatchObject({ suspended: true, onboarding_complete: false, current_school_id: null });

    expect((await asUser(BOB, "select id from public.messages")).rows).toEqual([]);
    expect((await asUser(BOB, "select id from public.profiles where id <> auth.uid()")).rows).toEqual([]);
    const send = await asUser(BOB, `select result_status from public.send_conversation_message('${conversationId}', 'after', gen_random_uuid())`);
    expect(send.rows[0]?.result_status ?? send.error).not.toBe("sent");
    expect((await asUser(BOB, `select * from public.create_behavior_report('profile', '${CAROL}', 'spam', null)`)).rows[0])
      .toMatchObject({ result_status: "onboarding_required" });
    const request = await asUser(BOB, `select * from public.send_friend_request('${CAROL}', 'hi')`);
    expect(request.rows[0]?.status ?? request.error).not.toBe("sent");
    const leave = await asUser(BOB, `delete from public.course_members where course_id = '${courseId}' and user_id = '${BOB}' returning 1`);
    expect(leave.rows).toEqual([]);
    expect((await asUser(BOB, `update public.profiles set display_name = 'Renamed' where id = '${BOB}'`)).error).toMatch(/account_suspended/);

    // 已发内容保留，其他成员照常可见。
    expect((await asUser(CAROL, `select body from public.messages where id = ${bobMessageId}`)).rows).toEqual([{ body: "bob before suspension" }]);
    expect(await context(CAROL)).toMatchObject({ suspended: false, onboarding_complete: true });

    // 普通成员看不到停用名单，也不能查别人是否被停用。
    expect((await asUser(CAROL, "select * from public.member_suspensions")).error).toMatch(/permission denied/);
    expect((await asUser(CAROL, `select public.member_is_suspended('${BOB}')`)).error).toMatch(/permission denied/);
    expect((await asUser(CAROL, "select public.current_member_is_suspended() as me")).rows).toEqual([{ me: false }]);
  });

  it("注册 Hook 拒绝停用邮箱（不分大小写），其他邮箱照常", async () => {
    expect(await hook("bob@WISC.edu")).toMatchObject({ error: { http_code: 403, message: "This account has been suspended." } });
    expect(await hook("new-student@wisc.edu")).toEqual({});
    expect(await hook("someone@example.com")).toMatchObject({ error: { http_code: 403 } });
  });

  it("停用期间可以永久注销；注销后仍不能用同一邮箱注册，按邮箱解除后才可以", async () => {
    const removed = await asRole("service_role", `select public.permanently_delete_member('${BOB}', '${"c".repeat(64)}') as status`);
    expect(removed).toEqual({ rows: [{ status: "completed" }], error: null });
    expect((await db.query("select user_id from public.member_suspensions")).rows).toEqual([{ user_id: null }]);
    expect(await hook("bob@wisc.edu")).toMatchObject({ error: { http_code: 403 } });

    expect((await asUser(ADMIN, "select public.admin_unsuspend_email('BOB@wisc.edu') as status")).rows).toEqual([{ status: "unsuspended" }]);
    expect(await hook("bob@wisc.edu")).toEqual({});
    expect((await asUser(ADMIN, "select public.admin_unsuspend_email('bob@wisc.edu') as status")).rows).toEqual([{ status: "not_suspended" }]);
  });

  it("解除停用后恢复访问", async () => {
    expect((await asUser(OWNER, `select public.admin_suspend_member('${CAROL}', null) as status`)).rows).toEqual([{ status: "suspended" }]);
    expect(await context(CAROL)).toMatchObject({ suspended: true });
    expect((await asUser(OWNER, `select public.admin_unsuspend_member('${CAROL}') as status`)).rows).toEqual([{ status: "unsuspended" }]);
    expect(await context(CAROL)).toMatchObject({ suspended: false, onboarding_complete: true, current_school_id: "uw-madison" });
    expect((await asUser(OWNER, `select public.admin_unsuspend_member('${CAROL}') as status`)).rows).toEqual([{ status: "not_suspended" }]);
    expect((await db.query<{ action: string }>("select action from public.admin_audit_log where action like 'member.%' order by id")).rows.map((row) => row.action))
      .toEqual(["member.suspend", "member.unsuspend_email", "member.suspend", "member.unsuspend"]);
  });
});
