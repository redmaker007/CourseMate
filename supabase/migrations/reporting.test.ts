import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const INCOMPLETE = "55555555-5555-4555-8555-555555555555";
const DAVE = "66666666-6666-4666-8666-666666666666";

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
] as const;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;

async function applyMigration(name: string) {
  const sql = await readFile(resolve(process.cwd(), "supabase/migrations", name), "utf8");
  await database.exec(sql);
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function asUser(userId: string, sql: string): Promise<Attempt> {
  await database.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`,
  );
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function asAnonymous(sql: string): Promise<Attempt> {
  await database.exec("set role anon;");
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function createFriendship() {
  const sent = await asUser(
    ALICE,
    `select * from public.send_friend_request('${BOB}', 'hello from Alice')`,
  );
  const requestId = sent.ok ? String(sent.rows[0].request_id) : "";
  const accepted = await asUser(
    BOB,
    `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
  );
  return {
    requestId,
    conversationId: accepted.ok ? String(accepted.rows[0].conversation_id) : "",
  };
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
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  for (const migration of MIGRATIONS.slice(0, 5)) await applyMigration(migration);
  await database.exec(`
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('umich', 'University of Michigan', 'University of Michigan', true);
    insert into public.school_email_domains (domain, school_id) values ('umich.edu', 'umich');
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now()),
      ('${DAVE}', 'dave@wisc.edu', now());
    insert into public.profiles (id, display_name, major, grad_year) values
      ('${ALICE}', 'Alice', 'Computer Science', 2027),
      ('${BOB}', 'Bob', 'Mathematics', 2028),
      ('${CAROL}', 'Carol', 'Physics', 2027),
      ('${DAVE}', 'Dave', 'History', 2029);
    insert into public.courses (school_id, code, title, term, created_by) values
      ('uw-madison', 'TEST00', 'Test Course', '2026-fall', '${ALICE}');
    insert into public.course_members (course_id, user_id)
    select id, member_id from public.courses
    cross join (values ('${ALICE}'::uuid), ('${BOB}'::uuid), ('${DAVE}'::uuid)) members(member_id);
  `);
  for (const migration of MIGRATIONS.slice(5)) await applyMigration(migration);
});

beforeEach(async () => {
  await database.exec(`
    truncate public.report_source_retention, public.report_evidence, public.behavior_reports;
    delete from public.friend_preferences;
    delete from public.friendships;
    delete from public.member_blocks;
    delete from public.conversations where kind = 'direct';
    delete from public.friend_rate_limit_buckets;
    delete from public.friend_request_active_pairs;
    delete from public.friend_requests;
    update public.profiles set display_name = case id
      when '${BOB}' then 'Bob' when '${DAVE}' then 'Dave' else display_name end;
  `);
});

describe("behavior reporting database boundary", () => {
  it("creates immutable server-derived snapshots for all supported target types", async () => {
    const friendship = await createFriendship();
    const sent = await asUser(
      BOB,
      `select * from public.send_direct_message('${friendship.conversationId}', '<script>alert(1)</script>')`,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";

    const requestReport = await asUser(
      BOB,
      `select * from public.create_behavior_report('friend_request', '${friendship.requestId}', 'spam', null)`,
    );
    const messageReport = await asUser(
      ALICE,
      `select * from public.create_behavior_report('message', '${messageId}', 'harassment', ' abusive ')`,
    );
    const profileReport = await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${DAVE}', 'impersonation', null)`,
    );

    expect(requestReport.ok && requestReport.rows[0].result_status, JSON.stringify(requestReport)).toBe("created");
    expect(messageReport.ok && messageReport.rows[0].result_status, JSON.stringify(messageReport)).toBe("created");
    expect(profileReport.ok && profileReport.rows[0].result_status, JSON.stringify(profileReport)).toBe("created");

    const evidence = await database.query<{
      reported_user_id: string;
      snapshot: Record<string, unknown>;
    }>(`select reported_user_id::text, snapshot from public.report_evidence order by snapshot->>'target_type'`);
    expect(evidence.rows).toHaveLength(3);
    expect(JSON.stringify(evidence.rows)).not.toContain("@wisc.edu");
    expect(evidence.rows.some((row) => row.snapshot.body === "<script>alert(1)</script>")).toBe(true);
    await expect(
      database.exec(`update public.report_evidence set snapshot = '{}'::jsonb`),
    ).rejects.toThrow(/immutable/);

    await database.exec(`
      update public.friend_requests set message = 'changed request'
        where id = '${friendship.requestId}';
      update public.messages set body = 'changed', deleted_at = now()
        where id = ${messageId};
      update public.profiles set display_name = 'Changed' where id = '${DAVE}';
      delete from auth.users where id = '${DAVE}';
    `);
    const afterChanges = await database.query<{
      snapshot: Record<string, unknown>;
      source_id: string;
    }>(`
      select evidence.snapshot, retention.source_id
      from public.report_evidence evidence
      join public.report_source_retention retention on retention.report_id = evidence.report_id
      order by evidence.snapshot->>'target_type'
    `);
    expect(afterChanges.rows).toHaveLength(3);
    expect(afterChanges.rows.some((row) => row.snapshot.message === "hello from Alice")).toBe(true);
    expect(afterChanges.rows.some((row) => row.snapshot.body === "<script>alert(1)</script>")).toBe(true);
    expect(afterChanges.rows.some((row) => row.snapshot.display_name === "Dave")).toBe(true);
    const retained = await database.query(`
      select evidence.reported_user_id::text, evidence.snapshot, retention.source_id
      from public.report_evidence evidence
      join public.report_source_retention retention on retention.report_id = evidence.report_id
      where evidence.reported_user_id = '${DAVE}'
    `);
    expect(retained.rows).toEqual([expect.objectContaining({
      reported_user_id: DAVE,
      source_id: DAVE,
      snapshot: expect.objectContaining({ display_name: "Dave" }),
    })]);
    const relationshipState = await database.query(`
      select
        (select active from public.friendships where pair_low = least('${ALICE}', '${BOB}')::uuid
          and pair_high = greatest('${ALICE}', '${BOB}')::uuid) as active,
        (select count(*)::int from public.member_blocks) as blocks
    `);
    expect(relationshipState.rows).toEqual([{ active: true, blocks: 0 }]);
  });

  it("rejects invisible, forged, self and invalid submissions and keeps retries idempotent", async () => {
    const friendship = await createFriendship();
    const duplicate1 = await asUser(
      BOB,
      `select * from public.create_behavior_report('friend_request', '${friendship.requestId}', 'spam', null)`,
    );
    const duplicate2 = await asUser(
      BOB,
      `select * from public.create_behavior_report('friend_request', '${friendship.requestId}', 'spam', null)`,
    );
    const self = await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${ALICE}', 'spam', null)`,
    );
    const invisible = await asUser(
      CAROL,
      `select * from public.create_behavior_report('friend_request', '${friendship.requestId}', 'spam', null)`,
    );
    const incomplete = await asUser(
      INCOMPLETE,
      `select * from public.create_behavior_report('profile', '${BOB}', 'spam', null)`,
    );
    const noDetails = await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${BOB}', 'other', '   ')`,
    );
    const tooLong = await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${BOB}', 'spam', ${literal("界".repeat(1001))})`,
    );
    const otherSchoolProfile = await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${CAROL}', 'spam', null)`,
    );

    expect(duplicate1.ok && duplicate1.rows[0].result_status, JSON.stringify(duplicate1)).toBe("created");
    expect(duplicate2.ok && duplicate2.rows).toEqual([{
      result_status: "already_pending",
      report_id: duplicate1.ok ? duplicate1.rows[0].report_id : null,
    }]);
    expect(self.ok && self.rows[0].result_status).toBe("self_report");
    expect(invisible.ok && invisible.rows[0].result_status).toBe("not_available");
    expect(incomplete.ok && incomplete.rows[0].result_status).toBe("onboarding_required");
    expect(noDetails.ok && noDetails.rows[0].result_status).toBe("invalid_details");
    expect(tooLong.ok && tooLong.rows[0].result_status).toBe("invalid_details");
    expect(otherSchoolProfile.ok && otherSchoolProfile.rows[0].result_status).toBe("not_available");

    const bypass = await asUser(
      ALICE,
      `insert into public.behavior_reports
       (reporter_id, target_type, target_id, reason)
       values ('${ALICE}', 'profile', '${BOB}', 'spam')`,
    );
    expect(bypass.ok).toBe(false);
  });

  it("lets a member read only their own report while evidence and moderation writes stay private", async () => {
    await asUser(
      ALICE,
      `select * from public.create_behavior_report('profile', '${BOB}', 'spam', null)`,
    );
    const own = await asUser(ALICE, "select status, reason from public.behavior_reports");
    const subject = await asUser(BOB, "select * from public.behavior_reports");
    const outsider = await asUser(CAROL, "select * from public.behavior_reports");
    const evidence = await asUser(ALICE, "select * from public.report_evidence");
    const retention = await asUser(ALICE, "select * from public.report_source_retention");
    const moderate = await asUser(ALICE, "update public.behavior_reports set status = 'actioned'");
    const anonymous = await asAnonymous("select * from public.behavior_reports");

    expect(own.ok && own.rows).toEqual([{ status: "pending", reason: "spam" }]);
    expect(subject.ok && subject.rows).toEqual([]);
    expect(outsider.ok && outsider.rows).toEqual([]);
    expect(evidence.ok).toBe(false);
    expect(retention.ok).toBe(false);
    expect(moderate.ok).toBe(false);
    expect(anonymous.ok).toBe(false);
  });
});

afterAll(async () => {
  await database?.close();
});
