import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const DAVE = "44444444-4444-4444-8444-444444444444";
const EVE = "55555555-5555-4555-8555-555555555555";

const MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090002_profile_onboarding.sql",
  "202609100001_unified_conversation_core.sql",
  "202609100002_course_flow.sql",
  "202609100003_friendship_backend.sql",
  "202609110001_friend_page_queries.sql",
  "202609110002_direct_messaging.sql",
  "202609110003_direct_chat_page.sql",
  "202609110004_reporting.sql",
  "202609110005_direct_message_cleanup.sql",
] as const;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;

async function applyMigration(name: string) {
  const sql = await readFile(resolve(process.cwd(), "supabase/migrations", name), "utf8");
  await database.exec(sql);
}

async function asRole(role: "authenticated" | "service_role", sql: string, userId?: string): Promise<Attempt> {
  await database.exec(`set role ${role};`);
  if (userId) {
    await database.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);`);
  }
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function createDirectConversation(requester = ALICE, recipient = BOB) {
  const sent = await asRole(
    "authenticated",
    `select * from public.send_friend_request('${recipient}', 'hello')`,
    requester,
  );
  const requestId = sent.ok ? String(sent.rows[0].request_id) : "";
  const accepted = await asRole(
    "authenticated",
    `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
    recipient,
  );
  return accepted.ok ? String(accepted.rows[0].conversation_id) : "";
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  for (const migration of MIGRATIONS.slice(0, 5)) await applyMigration(migration);
  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${DAVE}', 'dave@wisc.edu', now()),
      ('${EVE}', 'eve@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'), ('${BOB}', 'Bob'),
      ('${DAVE}', 'Dave'), ('${EVE}', 'Eve');
  `);
  for (const migration of MIGRATIONS.slice(5)) await applyMigration(migration);
});

beforeEach(async () => {
  await database.exec(`
    truncate public.direct_message_cleanup_runs,
      public.direct_message_cleanup_eligibility,
      public.direct_message_clear_ranges restart identity;
    truncate public.report_source_retention, public.report_evidence, public.behavior_reports;
    delete from public.friend_preferences;
    delete from public.friendships;
    delete from public.member_blocks;
    delete from public.conversations where kind = 'direct';
    delete from public.friend_rate_limit_buckets;
    delete from public.friend_request_active_pairs;
    delete from public.friend_requests;
  `);
});

describe("direct message physical cleanup", () => {
  it("starts the 30-day clock only when both clear ranges cover a message", async () => {
    const conversationId = await createDirectConversation();
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'keep until both clear')`,
      ALICE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";

    const aliceClear = await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      ALICE,
    );
    expect(
      aliceClear.ok && aliceClear.rows[0].clear_direct_conversation,
      JSON.stringify(aliceClear),
    ).toBe("updated");
    const afterOneClear = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp() + interval '40 days', 100)",
    );
    expect(afterOneClear.ok && afterOneClear.rows[0].candidate_count).toBe(0);

    const bobClear = await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      BOB,
    );
    expect(bobClear.ok && bobClear.rows[0].clear_direct_conversation).toBe("updated");
    const beforeDeadline = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp() + interval '29 days', 100)",
    );
    const atDeadline = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp() + interval '30 days', 100)",
    );

    expect(beforeDeadline.ok && beforeDeadline.rows[0].candidate_count).toBe(0);
    expect(atDeadline.ok && atDeadline.rows[0].candidate_count).toBe(2);
    expect(
      atDeadline.ok && (atDeadline.rows[0].message_ids as unknown[]).map(String),
    ).toContain(messageId);
  });

  it("allows only the backend role to delete an eligible batch without deleting the conversation", async () => {
    const conversationId = await createDirectConversation();
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'ready to clean')`,
      ALICE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      BOB,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '30 days'
    `);

    const unauthorized = await asRole(
      "authenticated",
      "select * from public.run_direct_message_cleanup(100)",
      ALICE,
    );
    expect(unauthorized.ok).toBe(false);
    const unauthorizedPreview = await asRole(
      "authenticated",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
      ALICE,
    );
    expect(unauthorizedPreview.ok).toBe(false);

    const executed = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(100)",
    );
    expect(executed.ok && executed.rows[0].result_status).toBe("completed");
    expect(executed.ok && executed.rows[0].deleted_count).toBe(2);
    expect(
      executed.ok && (executed.rows[0].message_ids as unknown[]).map(String),
    ).toContain(messageId);

    const remaining = await asRole(
      "authenticated",
      `select * from public.list_direct_messages('${conversationId}')`,
      ALICE,
    );
    expect(remaining.ok && remaining.rows).toEqual([]);

    const sentAfterCleanup = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'new history')`,
      BOB,
    );
    expect(sentAfterCleanup.ok && sentAfterCleanup.rows[0].result_status).toBe("sent");
    const preserved = await database.query(`
      select
        (select count(*)::int from public.conversations where id = '${conversationId}') as conversations,
        (select count(*)::int from public.direct_conversations where conversation_id = '${conversationId}') as direct_links,
        (select count(*)::int from public.conversation_members where conversation_id = '${conversationId}') as members,
        (select count(*)::int from public.friendships where active) as friendships
    `);
    expect(preserved.rows).toEqual([{
      conversations: 1,
      direct_links: 1,
      members: 2,
      friendships: 1,
    }]);
  });

  it("cleans only the portion covered by both members and leaves newer messages pending", async () => {
    const conversationId = await createDirectConversation();
    const first = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'covered by both')`,
      ALICE,
    );
    const firstId = first.ok ? String(first.rows[0].message_id) : "";
    const second = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'covered by bob only')`,
      BOB,
    );
    const secondId = second.ok ? String(second.rows[0].message_id) : "";

    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${firstId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${secondId})`,
      BOB,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '31 days'
    `);

    const preview = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    const candidateIds = preview.ok
      ? (preview.rows[0].message_ids as unknown[]).map(String)
      : [];
    expect(candidateIds).toContain(firstId);
    expect(candidateIds).not.toContain(secondId);

    const sentAfterClear = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'new after both positions')`,
      ALICE,
    );
    const newId = sentAfterClear.ok ? String(sentAfterClear.rows[0].message_id) : "";
    const previewAgain = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp() + interval '40 days', 100)",
    );
    expect(
      previewAgain.ok && (previewAgain.rows[0].message_ids as unknown[]).map(String),
    ).not.toContain(newId);
  });

  it("uses an exact timestamptz boundary independent of the session timezone", async () => {
    const conversationId = await createDirectConversation();
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'timezone boundary')`,
      ALICE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      BOB,
    );
    await database.exec(`
      set timezone = 'America/Chicago';
      update public.direct_message_cleanup_eligibility
      set eligible_since = '2026-02-08T07:30:00Z'::timestamptz
      where message_id = ${messageId};
    `);

    const tooEarly = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup('2026-03-10T07:29:59.999999Z', 100)",
    );
    const exact = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup('2026-03-10T07:30:00Z', 100)",
    );
    expect(
      tooEarly.ok && (tooEarly.rows[0].message_ids as unknown[]).map(String),
    ).not.toContain(messageId);
    expect(
      exact.ok && (exact.rows[0].message_ids as unknown[]).map(String),
    ).toContain(messageId);
    await database.exec("reset timezone;");
  });

  it("never selects or deletes a message held by a report", async () => {
    const conversationId = await createDirectConversation();
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'reported evidence')`,
      ALICE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    const reported = await asRole(
      "authenticated",
      `select * from public.create_behavior_report('message', '${messageId}', 'harassment', null)`,
      BOB,
    );
    expect(reported.ok && reported.rows[0].result_status).toBe("created");

    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      BOB,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '31 days'
    `);

    const preview = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    expect(preview.ok && preview.rows[0].candidate_count).toBe(1);
    expect(
      preview.ok && (preview.rows[0].message_ids as unknown[]).map(String),
    ).not.toContain(messageId);

    const executed = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(100)",
    );
    expect(executed.ok && executed.rows[0].deleted_count).toBe(1);
    const retained = await database.query(`
      select message.id::text, retention.message_id::text as retained_id
      from public.messages message
      join public.report_source_retention retention
        on retention.message_id = message.id
      where message.id = ${messageId}
    `);
    expect(retained.rows).toEqual([{ id: messageId, retained_id: messageId }]);
    await expect(
      database.exec(`delete from public.messages where id = ${messageId}`),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("uses deterministic limited batches and repeated runs delete nothing extra", async () => {
    const conversationId = await createDirectConversation();
    const sentIds: string[] = [];
    for (const body of ["second", "third"]) {
      const sent = await asRole(
        "authenticated",
        `select * from public.send_direct_message('${conversationId}', '${body}')`,
        ALICE,
      );
      if (sent.ok) sentIds.push(String(sent.rows[0].message_id));
    }
    const latestId = sentIds.at(-1)!;
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${latestId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${latestId})`,
      BOB,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '31 days'
    `);

    const first = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(2)",
    );
    const second = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(2)",
    );
    const third = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(2)",
    );

    expect(first.ok && first.rows[0].deleted_count).toBe(2);
    expect(second.ok && second.rows[0].deleted_count).toBe(1);
    expect(third.ok && third.rows[0].deleted_count).toBe(0);
    const firstIds = first.ok
      ? (first.rows[0].message_ids as unknown[]).map(String)
      : [];
    expect(firstIds).toEqual([...firstIds].sort((a, b) => Number(a) - Number(b)));
    const audits = await asRole(
      "service_role",
      "select result_status, deleted_count from public.direct_message_cleanup_runs where run_mode = 'execute' order by started_at",
    );
    expect(audits.ok && audits.rows).toHaveLength(3);
    expect(audits.ok && audits.rows.every((row) => row.result_status === "completed")).toBe(true);
  });

  it("excludes non-direct conversations and conversations with a deleted participant", async () => {
    const courseConversation = "77777777-7777-4777-8777-777777777777";
    const customConversation = "88888888-8888-4888-8888-888888888888";
    await database.exec(`
      insert into public.conversations (id, kind) values
        ('${courseConversation}', 'course'),
        ('${customConversation}', 'custom');
      insert into public.messages (conversation_id, sender_id, body)
      values
        ('${courseConversation}', '${ALICE}', 'course history'),
        ('${customConversation}', '${ALICE}', 'custom history');
      insert into public.direct_message_cleanup_eligibility
        (message_id, conversation_id, eligible_since)
      select id, conversation_id, clock_timestamp() - interval '31 days'
      from public.messages
      where conversation_id in ('${courseConversation}', '${customConversation}');
    `);

    const directConversation = await createDirectConversation(DAVE, EVE);
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${directConversation}', 'account removed')`,
      DAVE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${directConversation}', ${messageId})`,
      DAVE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${directConversation}', ${messageId})`,
      EVE,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '31 days';
      delete from auth.users where id = '${EVE}';
    `);

    const preview = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    expect(preview.ok && preview.rows[0].candidate_count).toBe(0);
    const messages = await database.query(`
      select count(*)::int as count from public.messages
      where conversation_id in ('${courseConversation}', '${customConversation}', '${directConversation}')
    `);
    expect(messages.rows).toEqual([{ count: 4 }]);
  });

  it("provides the cleanup indexes and a bounded batch query plan", async () => {
    const indexes = await database.query(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'direct_message_clear_ranges_cover_idx',
          'direct_message_cleanup_eligibility_batch_idx',
          'report_source_retention_message_idx'
        )
      order by indexname
    `);
    expect(indexes.rows).toEqual([
      { indexname: "direct_message_cleanup_eligibility_batch_idx" },
      { indexname: "direct_message_clear_ranges_cover_idx" },
      { indexname: "report_source_retention_message_idx" },
    ]);

    await database.exec("set enable_seqscan = off;");
    const explained = await database.query(`
      explain select message_id
      from public.direct_message_cleanup_eligibility
      order by eligible_since, message_id
      limit 100
    `);
    await database.exec("reset enable_seqscan;");
    expect(JSON.stringify(explained.rows)).toContain(
      "direct_message_cleanup_eligibility_batch_idx",
    );
  });

  it("records a failed batch without partially deleting its candidates", async () => {
    const conversationId = await createDirectConversation();
    const sent = await asRole(
      "authenticated",
      `select * from public.send_direct_message('${conversationId}', 'trigger failure')`,
      ALICE,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      ALICE,
    );
    await asRole(
      "authenticated",
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
      BOB,
    );
    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '31 days';
      create function public.reject_test_cleanup() returns trigger language plpgsql
      as $$ begin raise exception 'simulated cleanup failure'; end $$;
      create trigger reject_test_cleanup before delete on public.messages
      for each row execute function public.reject_test_cleanup();
    `);

    const executed = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(100)",
    );
    expect(executed.ok && executed.rows[0].result_status).toBe("failed");
    expect(executed.ok && executed.rows[0].deleted_count).toBe(0);
    const audit = await asRole(
      "service_role",
      "select result_status, error_details from public.direct_message_cleanup_runs where run_mode = 'execute'",
    );
    expect(audit.ok && audit.rows).toEqual([{
      result_status: "failed",
      error_details: "simulated cleanup failure",
    }]);
    const stillPresent = await database.query(`
      select count(*)::int as count from public.messages
      where conversation_id = '${conversationId}'
    `);
    expect(stillPresent.rows).toEqual([{ count: 2 }]);
    await database.exec(`
      drop trigger reject_test_cleanup on public.messages;
      drop function public.reject_test_cleanup();
    `);
  });
});

afterAll(async () => {
  await database?.close();
});
