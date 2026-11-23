import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 课程群消息举报（202611220001）。按真实顺序跑完整迁移链，用真实角色和 RLS 验证：
 * 只有当前可读该课程会话的成员能举报；证据与被举报人由服务端推导；
 * 私聊举报行为不回退；被举报消息受留存保护；永久注销仍能匿名化课程举报。
 * 简化 Auth／Storage fixture，不代替托管环境验证。
 */

const ALICE = "c1111111-1111-4111-8111-111111111111"; // wisc，课程成员（发消息的人）
const BOB = "c2222222-2222-4222-8222-222222222222"; // wisc，课程成员（举报人）
const DAVE = "c3333333-3333-4333-8333-333333333333"; // wisc，课程成员（之后退出课程）
const OUTSIDER = "c4444444-4444-4444-8444-444444444444"; // wisc，不在该课程
const CAROL = "c5555555-5555-4555-8555-555555555555"; // umich，外校

type Result = { rows: Record<string, unknown>[]; error: string | null };
let db: PGlite;
let courseId = "";
let conversationId = "";

async function asRole(role: "authenticated" | "anon" | "service_role", sql: string, user = ""): Promise<Result> {
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

async function sendCourseMessage(user: string, body: string) {
  const sent = await asUser(
    user,
    `select message_id::text from public.send_conversation_message('${conversationId}', '${body}', gen_random_uuid())`,
  );
  if (sent.error) throw new Error(sent.error);
  return String(sent.rows[0].message_id);
}

async function report(user: string, messageId: string, reason = "harassment", details: string | null = null) {
  const result = await asUser(
    user,
    `select result_status, report_id::text from public.create_behavior_report('message', '${messageId}', '${reason}', ${details === null ? "null" : `'${details}'`})`,
  );
  if (result.error) throw new Error(result.error);
  return result.rows[0] as { result_status: string; report_id: string | null };
}

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
    grant usage on schema auth to anon, authenticated, service_role;
    create publication supabase_realtime; grant usage on schema public to anon, authenticated, service_role;
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
      ('${ALICE}', 'alice@wisc.edu', now()), ('${BOB}', 'bob@wisc.edu', now()),
      ('${DAVE}', 'dave@wisc.edu', now()), ('${OUTSIDER}', 'outsider@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now());
    insert into public.profiles (id, display_name, major, grad_year) values
      ('${ALICE}', 'Alice', 'CS', 2027), ('${BOB}', 'Bob', 'Math', 2027),
      ('${DAVE}', 'Dave', 'History', 2028), ('${OUTSIDER}', 'Outsider', 'Art', 2027),
      ('${CAROL}', 'Carol', 'Physics', 2027);
    insert into public.courses (school_id, code, title, term) values
      ('uw-madison', 'CS 300', 'Reporting', '2026-fall');
  `);
  courseId = (await db.query<{ id: string }>("select id::text from public.courses where code = 'CS 300'")).rows[0].id;
  // 加入课程走真实路径：成员身份插入，触发器惰性创建会话。
  for (const user of [ALICE, BOB, DAVE]) {
    const joined = await asUser(user, `insert into public.course_members (course_id) values ('${courseId}')`);
    if (joined.error) throw new Error(joined.error);
  }
  conversationId = (await db.query<{ id: string }>(
    `select conversation_id::text as id from public.course_conversations where course_id = '${courseId}'`,
  )).rows[0].id;
});

afterAll(async () => {
  await db?.close();
});

describe("课程群消息举报：完整迁移链与真实权限", () => {
  it("课程成员举报他人课程消息时，服务端推导被举报人并留存不可变证据", async () => {
    const messageId = await sendCourseMessage(ALICE, "course abuse body");
    const created = await report(BOB, messageId, "harassment", " 辱骂 ");
    expect(created.result_status).toBe("created");

    const evidence = await db.query<Record<string, unknown>>(`
      select report.reporter_id::text, report.target_type, report.target_id, report.details,
        evidence.reported_user_id::text, evidence.snapshot, retention.source_type, retention.message_id::text
      from public.behavior_reports report
      join public.report_evidence evidence on evidence.report_id = report.id
      join public.report_source_retention retention on retention.report_id = report.id
      where report.id = '${created.report_id}'`);
    expect(evidence.rows).toEqual([{
      reporter_id: BOB,
      target_type: "message",
      target_id: messageId,
      details: "辱骂",
      reported_user_id: ALICE,
      snapshot: expect.objectContaining({
        target_type: "message",
        message_id: Number(messageId),
        conversation_id: conversationId,
        conversation_kind: "course",
        course_id: courseId,
        body: "course abuse body",
      }),
      source_type: "message",
      message_id: messageId,
    }]);
    expect(JSON.stringify(evidence.rows)).not.toContain("@wisc.edu");

    // 重试幂等：同一目标已有 pending 时返回原回执。
    expect(await report(BOB, messageId, "spam")).toEqual({
      result_status: "already_pending",
      report_id: created.report_id,
    });
    // 证据不可变；被举报消息不能被硬删（会级联删课程的路径同样被挡住）。
    await expect(db.exec(`update public.report_evidence set snapshot = '{}'::jsonb`)).rejects.toThrow(/immutable/);
    await expect(db.exec(`delete from public.messages where id = ${messageId}`)).rejects.toThrow(/report_source_retention_message_fkey/);
    await expect(db.exec(`delete from public.courses where id = '${courseId}'`)).rejects.toThrow(/report_source_retention_message_fkey/);
  });

  it("非课程成员、外校成员、自己、已删除消息与退出课程后都不能举报", async () => {
    const messageId = await sendCourseMessage(ALICE, "visible only to members");
    expect((await report(OUTSIDER, messageId)).result_status).toBe("not_available");
    expect((await report(CAROL, messageId)).result_status).toBe("not_available");
    expect((await report(ALICE, messageId)).result_status).toBe("self_report");

    const removed = await sendCourseMessage(ALICE, "soon removed");
    await db.exec(`update public.messages set deleted_at = now() where id = ${removed}`);
    expect((await report(BOB, removed)).result_status).toBe("not_available");

    // 退出课程后不再可读，也就不能举报；退出前已经可读不构成资格。
    const left = await asUser(DAVE, `delete from public.course_members where course_id = '${courseId}' and user_id = '${DAVE}'`);
    expect(left.error).toBeNull();
    expect((await report(DAVE, messageId)).result_status).toBe("not_available");

    // 客户端不能绕过 RPC 直接写举报或读证据。
    expect((await asUser(BOB, `insert into public.behavior_reports (reporter_id, target_type, target_id, reason)
      values ('${BOB}', 'message', '${messageId}', 'spam')`)).error).not.toBeNull();
    expect((await asUser(BOB, "select * from public.report_evidence")).error).toMatch(/permission denied/);
    expect((await asUser(ALICE, "select * from public.behavior_reports")).rows).toEqual([]);
  });

  it("私聊消息举报保持原行为，快照标明 direct 且不含 course_id", async () => {
    const request = await asUser(ALICE, `select request_id from public.send_friend_request('${BOB}', 'hi')`);
    const accepted = await asUser(BOB, `select conversation_id from public.respond_to_friend_request('${request.rows[0].request_id}', 'accept')`);
    const direct = String(accepted.rows[0].conversation_id);
    const sent = await asUser(ALICE, `select message_id::text from public.send_conversation_message('${direct}', 'direct body', gen_random_uuid())`);
    const messageId = String(sent.rows[0].message_id);

    expect((await report(OUTSIDER, messageId)).result_status).toBe("not_available");
    const created = await report(BOB, messageId);
    expect(created.result_status).toBe("created");
    const snapshot = (await db.query<{ snapshot: Record<string, unknown> }>(
      `select snapshot from public.report_evidence where report_id = '${created.report_id}'`,
    )).rows[0].snapshot;
    expect(snapshot).toMatchObject({ conversation_kind: "direct", body: "direct body" });
    expect(snapshot).not.toHaveProperty("course_id");
  });

  it("被举报人永久注销后，课程消息举报匿名保留，正文仍可供审核", async () => {
    const messageId = await sendCourseMessage(ALICE, "evidence after deletion");
    const created = await report(BOB, messageId, "threat");
    expect(created.result_status).toBe("created");

    const removed = await asRole("service_role", `select public.permanently_delete_member('${ALICE}', '${"b".repeat(64)}') as status`);
    expect(removed).toEqual({ rows: [{ status: "completed" }], error: null });

    const row = (await db.query<Record<string, unknown>>(`
      select report.reporter_id::text, evidence.reported_user_id, evidence.snapshot
      from public.behavior_reports report join public.report_evidence evidence on evidence.report_id = report.id
      where report.id = '${created.report_id}'`)).rows[0];
    expect(row).toMatchObject({
      reporter_id: BOB,
      reported_user_id: null,
      snapshot: expect.objectContaining({ body: "evidence after deletion", conversation_kind: "course", subject: "deleted_account" }),
    });
    expect((await db.query(`select sender_id, body from public.messages where id = ${messageId}`)).rows)
      .toEqual([{ sender_id: null, body: "[消息已删除]" }]);
  });
});
