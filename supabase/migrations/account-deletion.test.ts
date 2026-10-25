import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "a".repeat(64);
let db: PGlite;

async function asRole(role: "authenticated" | "anon" | "service_role", sql: string, user = "") {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
  try { return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null }; }
  catch (error) { return { rows: [], error: (error as Error).message }; }
  finally { await db.exec("reset role"); }
}
const asUser = (user: string, sql: string) => asRole("authenticated", sql, user);
const remove = (user = ALICE, receipt = RECEIPT) => asRole("service_role", `select public.permanently_delete_member('${user}', '${receipt}') as status`);

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
    create publication supabase_realtime; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  for (const file of (await readdir(resolve(process.cwd(), "supabase/migrations"))).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", file), "utf8"));
  }
});
beforeEach(async () => {
  await db.exec(`drop trigger if exists deletion_test_failure on auth.users;
    truncate auth.users cascade; truncate public.behavior_reports cascade; truncate auth.audit_log_entries, storage.objects, public.push_dispatches;
    insert into auth.users values ('${ALICE}','alice@wisc.edu',now()),('${BOB}','bob@wisc.edu',now()),('${CAROL}','carol@wisc.edu',now());
    insert into public.profiles(id,display_name,major,grad_year) values ('${ALICE}','Alice','CS',2027),('${BOB}','Bob','Math',2027),('${CAROL}','Carol','Art',2027);`);
  if ((await db.query<{name: string | null}>("select to_regclass('public.account_deletion_receipts') as name")).rows[0].name) await db.exec("truncate public.account_deletion_receipts");
});
afterAll(async () => { await db?.close(); });

async function conversation() {
  const request = await asUser(ALICE, `select request_id from public.send_friend_request('${BOB}', 'Alice introduction')`);
  const requestId = String(request.rows[0].request_id);
  const accepted = await asUser(BOB, `select conversation_id from public.respond_to_friend_request('${requestId}', 'accept')`);
  const id = String(accepted.rows[0].conversation_id);
  const own = await asUser(ALICE, `select message_id::text from public.send_conversation_message('${id}', 'Alice private body', gen_random_uuid())`);
  const other = await asUser(BOB, `select message_id::text from public.send_conversation_message('${id}', 'Bob original body', gen_random_uuid())`);
  return { id, requestId, own: String(own.rows[0].message_id), other: String(other.rows[0].message_id) };
}

describe("永久注销完整迁移链与真实权限（简化 Auth／Storage fixture，不代替托管验证）", () => {
  it("一次提交清本人内容／身份和关联副本，保留他人原消息与稳定占位，随机回执支持重试", async () => {
    const c = await conversation();
    await asUser(BOB, `select * from public.create_behavior_report('message','${c.own}','harassment',null)`);
    await asUser(ALICE, `select * from public.create_behavior_report('message','${c.other}','spam',null)`);
    const unrelated = await asUser(CAROL, `select report_id from public.create_behavior_report('profile','${BOB}','spam',null)`);
    await db.exec(`insert into public.push_subscriptions values ('https://synthetic.test/push','${ALICE}','key','secret',now());
      insert into auth.sessions values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ALICE}');
      insert into auth.identities values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${ALICE}');
      insert into auth.refresh_tokens(user_id,session_id) values ('${ALICE}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      insert into public.admin_audit_log(actor_id,action,target,details) values ('${BOB}','staff.grant_admin','${ALICE}','{"email":"alice@wisc.edu"}');
      insert into auth.audit_log_entries(payload) values ('{"actor_id":"${ALICE}","actor_username":"alice@wisc.edu"}');`);
    expect(await remove()).toEqual({ rows: [{ status: "completed" }], error: null });
    expect(await remove()).toEqual({ rows: [{ status: "completed" }], error: null });
    const counts = await db.query(`select
      (select count(*)::int from auth.users where id='${ALICE}') as auth,
      (select count(*)::int from public.profiles where id='${ALICE}') as profile,
      (select count(*)::int from public.friend_requests where pair_low='${ALICE}' or pair_high='${ALICE}') as requests,
      (select count(*)::int from public.push_subscriptions where user_id='${ALICE}') as push,
      (select count(*)::int from auth.refresh_tokens where user_id='${ALICE}') as refresh,
      (select count(*)::int from auth.audit_log_entries) as auth_audit`);
    expect(counts.rows).toEqual([{ auth: 0, profile: 0, requests: 0, push: 0, refresh: 0, auth_audit: 0 }]);
    expect((await db.query(`select sender_id,body,client_message_id,deleted_at is not null as deleted from public.messages where id=${c.own}`)).rows)
      .toEqual([{ sender_id: null, body: "[消息已删除]", client_message_id: null, deleted: true }]);
    expect((await asUser(BOB, `select body from public.messages where id=${c.other}`)).rows).toEqual([{ body: "Bob original body" }]);
    expect((await db.query("select id from public.behavior_reports")).rows).toEqual([{ id: unrelated.rows[0].report_id }]);
    expect((await db.query(`select target,details from public.admin_audit_log`)).rows).toEqual([{ target: null, details: {} }]);
    expect((await asRole("service_role", `select public.get_account_deletion_receipt('${RECEIPT}') as status`)).rows).toEqual([{ status: "completed" }]);
    expect((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='account_deletion_receipts' order by ordinal_position")).rows)
      .toEqual([{ column_name: "receipt_hash" }, { column_name: "completed_at" }]);
  });

  it("普通／匿名角色不能调用管理删除或读取回执，伪造事务开关也不能修改证据", async () => {
    const c = await conversation();
    await asUser(BOB, `select * from public.create_behavior_report('message','${c.own}','spam',null)`);
    for (const role of ["anon", "authenticated"] as const) {
      expect((await asRole(role, `select public.permanently_delete_member('${ALICE}','${RECEIPT}')`, BOB)).error).toMatch(/permission denied/);
      expect((await asRole(role, `select public.get_account_deletion_receipt('${RECEIPT}')`, BOB)).error).toMatch(/permission denied/);
      expect((await asRole(role, "select * from public.account_deletion_receipts", BOB)).error).toMatch(/permission denied/);
    }
    await asRole("service_role", "select set_config('coursemate.account_deletion','on',false)");
    expect((await asRole("service_role", "delete from public.report_evidence")).error).toMatch(/immutable/);
    await db.exec("select set_config('coursemate.account_deletion','',false)");
    expect((await db.query(`select count(*)::int as count from auth.users where id='${ALICE}'`)).rows).toEqual([{ count: 1 }]);
  });

  it("Auth 删除失败时整笔回滚，证据／消息／申请／会话和刷新能力均保留，移除故障后可重试", async () => {
    const c = await conversation();
    await asUser(BOB, `select * from public.create_behavior_report('message','${c.own}','spam',null)`);
    await db.exec(`insert into auth.sessions values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ALICE}');
      insert into auth.refresh_tokens(user_id,session_id) values ('${ALICE}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      create or replace function public.deletion_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic deletion failure'; end;$$;
      create trigger deletion_test_failure before delete on auth.users for each row execute function public.deletion_test_fail();`);
    expect((await remove()).error).toContain("synthetic deletion failure");
    expect((await db.query(`select body,sender_id,deleted_at from public.messages where id=${c.own}`)).rows)
      .toEqual([{ body: "Alice private body", sender_id: ALICE, deleted_at: null }]);
    expect((await db.query("select count(*)::int as count from public.report_evidence")).rows).toEqual([{ count: 1 }]);
    expect((await db.query(`select count(*)::int as count from public.friend_requests where id='${c.requestId}'`)).rows).toEqual([{ count: 1 }]);
    expect((await db.query(`select count(*)::int as count from auth.refresh_tokens where user_id='${ALICE}'`)).rows).toEqual([{ count: 1 }]);
    expect((await asRole("service_role", `select public.get_account_deletion_receipt('${RECEIPT}') as status`)).rows).toEqual([{ status: "not_completed" }]);
    await db.exec("drop trigger deletion_test_failure on auth.users");
    expect((await remove()).rows).toEqual([{ status: "completed" }]);
  });

  it("保留唯一 owner 保护；未清的托管对象明确拒绝，不能假报完成或部分清理", async () => {
    await db.exec(`insert into public.platform_roles(user_id,role) values ('${ALICE}','owner')`);
    expect((await remove()).rows).toEqual([{ status: "owner_transfer_required" }]);
    await db.exec(`update public.platform_roles set user_id='${BOB}' where user_id='${ALICE}';
      insert into storage.objects values (gen_random_uuid(),'${ALICE}')`);
    expect((await remove()).rows).toEqual([{ status: "storage_cleanup_required" }]);
    expect((await db.query(`select display_name from public.profiles where id='${ALICE}'`)).rows).toEqual([{ display_name: "Alice" }]);
    await db.exec("truncate storage.objects");
    expect((await remove()).rows).toEqual([{ status: "completed" }]);
    expect((await db.query("select user_id from public.platform_roles where role='owner'")).rows).toEqual([{ user_id: BOB }]);
  });

  it("课程消息也清本人正文，保留课程、共享会话和其他成员消息；旧身份不能读取或重新举报占位", async () => {
    const courseId="a1111111-1111-4111-8111-111111111111";
    await db.exec(`insert into public.courses(id,school_id,code,title,term,created_by)
      select '${courseId}','uw-madison','DEL 901','Deletion fixture',current_term,'${ALICE}'
      from public.school_term_settings where school_id='uw-madison'`);
    await asUser(ALICE,`insert into public.course_members(course_id) values ('${courseId}')`);
    await asUser(BOB,`insert into public.course_members(course_id) values ('${courseId}')`);
    const id=(await db.query<{conversation_id:string}>(`select conversation_id from public.course_conversations where course_id='${courseId}'`)).rows[0].conversation_id;
    const own=await asUser(ALICE,`select message_id::text from public.send_conversation_message('${id}','private course body',gen_random_uuid())`);
    const other=await asUser(BOB,`select message_id::text from public.send_conversation_message('${id}','other course body',gen_random_uuid())`);
    expect((await remove()).rows).toEqual([{status:"completed"}]);
    expect((await db.query(`select created_by from public.courses where id='${courseId}'`)).rows).toEqual([{created_by:null}]);
    expect((await asUser(BOB,`select body from public.messages where id=${other.rows[0].message_id}`)).rows).toEqual([{body:"other course body"}]);
    expect((await asUser(BOB,`select id::text from public.messages where conversation_id='${id}' and deleted_at is null`)).rows).toEqual([{id:other.rows[0].message_id}]);
    expect((await asUser(ALICE,`select * from public.messages where conversation_id='${id}'`)).rows).toEqual([]);
    expect((await asUser(ALICE,`select result_status from public.create_behavior_report('message','${own.rows[0].message_id}','spam',null)`)).rows).toEqual([{result_status:"onboarding_required"}]);
  });

  it("注销不强迫补完资料或恢复停用学校；旧身份和重复请求不能删同邮箱的新账号", async () => {
    await db.exec(`delete from public.profiles where id='${ALICE}'; update public.schools set enabled=false where id='uw-madison'`);
    try { expect((await remove()).rows).toEqual([{ status: "completed" }]); }
    finally { await db.exec("update public.schools set enabled=true where id='uw-madison'"); }
    const replacement = "44444444-4444-4444-8444-444444444444";
    await db.exec(`insert into auth.users values ('${replacement}','alice@wisc.edu',now())`);
    expect((await remove()).rows).toEqual([{ status: "completed" }]);
    expect((await remove(ALICE, "b".repeat(64))).rows).toEqual([{ status: "not_available" }]);
    expect((await db.query(`select email from auth.users where id='${replacement}'`)).rows).toEqual([{ email: "alice@wisc.edu" }]);
  });
});
