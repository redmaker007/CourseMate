import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * 举报证据到期清理（202611220003）。完整迁移链：处理时间自动记录；处理满一年的证据去掉正文、
 * 补充说明和留存行；未满一年或待处理的不动；普通角色不能执行，也不能伪造开关改证据。
 */

const ALICE = "e1111111-1111-4111-8111-111111111111";
const BOB = "e2222222-2222-4222-8222-222222222222";
let db: PGlite;
let conversationId = "";

async function asRole(role: "authenticated" | "service_role", sql: string, user = "") {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
  try {
    return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null as string | null };
  } catch (error) {
    return { rows: [], error: (error as Error).message };
  } finally {
    await db.exec("reset role");
  }
}

async function reportedMessage(body: string, details: string | null = "他骂人") {
  const sent = await asRole("authenticated",
    `select message_id::text from public.send_conversation_message('${conversationId}', '${body}', gen_random_uuid())`, ALICE);
  const messageId = String(sent.rows[0].message_id);
  const report = await asRole("authenticated",
    `select report_id::text from public.create_behavior_report('message', '${messageId}', 'harassment', ${details === null ? "null" : `'${details}'`})`, BOB);
  return { messageId, reportId: String(report.rows[0].report_id) };
}

const redact = () => asRole("service_role", "select public.redact_expired_report_evidence() as count");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text unique, email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
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
    insert into auth.users values ('${ALICE}', 'alice@wisc.edu', now()), ('${BOB}', 'bob@wisc.edu', now());
    insert into public.profiles (id, display_name) values ('${ALICE}', 'Alice'), ('${BOB}', 'Bob');
    insert into public.courses (school_id, code, title, term) values ('uw-madison', 'RT 100', 'Retention', '2026-fall');
  `);
  const course = (await db.query<{ id: string }>("select id::text from public.courses where code = 'RT 100'")).rows[0].id;
  for (const user of [ALICE, BOB]) {
    await asRole("authenticated", `insert into public.course_members (course_id) values ('${course}')`, user);
  }
  conversationId = (await db.query<{ id: string }>(
    `select conversation_id::text as id from public.course_conversations where course_id = '${course}'`,
  )).rows[0].id;
});

beforeEach(async () => {
  await db.exec("truncate public.behavior_reports cascade");
});

afterAll(async () => {
  await db?.close();
});

describe("举报证据到期清理", () => {
  it("状态离开 pending 时自动记录处理时间，回到 pending 时清空", async () => {
    const { reportId } = await reportedMessage("abuse one");
    const read = async () => (await db.query<{ resolved: boolean }>(
      `select resolved_at is not null as resolved from public.behavior_reports where id = '${reportId}'`)).rows[0].resolved;
    expect(await read()).toBe(false);
    await db.exec(`update public.behavior_reports set status = 'actioned' where id = '${reportId}'`);
    expect(await read()).toBe(true);
    await db.exec(`update public.behavior_reports set status = 'pending' where id = '${reportId}'`);
    expect(await read()).toBe(false);
  });

  it("处理满一年的证据去掉正文、说明和留存；未满一年和待处理的不动", async () => {
    const expired = await reportedMessage("expired abuse body");
    const recent = await reportedMessage("recent abuse body");
    const pending = await reportedMessage("pending abuse body");
    await db.exec(`update public.behavior_reports set status = 'actioned' where id in ('${expired.reportId}', '${recent.reportId}');
      update public.behavior_reports set resolved_at = now() - interval '366 days' where id = '${expired.reportId}';
      update public.behavior_reports set resolved_at = now() - interval '300 days' where id = '${recent.reportId}';`);

    expect(await redact()).toEqual({ rows: [{ count: 1 }], error: null });
    expect(await redact()).toEqual({ rows: [{ count: 0 }], error: null });

    const rows = await db.query<{ id: string; status: string; reason: string; details: string | null; snapshot: Record<string, unknown>; redacted: boolean; retained: number }>(`
      select r.id::text, r.status, r.reason, r.details, e.snapshot, e.redacted_at is not null as redacted,
        (select count(*)::int from public.report_source_retention s where s.report_id = r.id) as retained
      from public.behavior_reports r join public.report_evidence e on e.report_id = r.id`);
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));

    expect(byId[expired.reportId]).toMatchObject({ status: "actioned", reason: "harassment", details: "[已清理]", redacted: true, retained: 0 });
    expect(byId[expired.reportId].snapshot).toEqual({
      target_type: "message",
      message_id: Number(expired.messageId),
      conversation_id: conversationId,
      conversation_kind: "course",
      course_id: expect.any(String),
      created_at: expect.any(String),
      redacted: true,
    });
    expect(JSON.stringify(byId[expired.reportId])).not.toContain("expired abuse body");
    expect(byId[recent.reportId]).toMatchObject({ details: "他骂人", redacted: false, retained: 1,
      snapshot: expect.objectContaining({ body: "recent abuse body" }) });
    expect(byId[pending.reportId]).toMatchObject({ status: "pending", redacted: false, retained: 1 });

    // 留存释放后，被举报消息不再被外键锁住；仍在留存期的消息照旧受保护。
    await expect(db.exec(`delete from public.messages where id = ${expired.messageId}`)).resolves.toBeDefined();
    await expect(db.exec(`delete from public.messages where id = ${recent.messageId}`)).rejects.toThrow(/report_source_retention_message_fkey/);
  });

  it("普通成员不能执行清理，伪造开关也不能改证据", async () => {
    const { reportId } = await reportedMessage("still protected");
    expect((await asRole("authenticated", "select public.redact_expired_report_evidence()", BOB)).error).toMatch(/permission denied/);
    await asRole("service_role", "select set_config('coursemate.report_retention', 'on', false)");
    expect((await asRole("service_role", `update public.report_evidence set snapshot = '{}'::jsonb where report_id = '${reportId}'`)).error)
      .toMatch(/immutable/);
    await db.exec("select set_config('coursemate.report_retention', '', false)");
  });
});
