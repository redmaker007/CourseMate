import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";
const INCOMPLETE = "55555555-5555-4555-8555-555555555555";

const MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090001_course_catalog.sql",
  "202609090002_profile_onboarding.sql",
  "202609100001_unified_conversation_core.sql",
  "202609100002_course_flow.sql",
  "202609100003_friendship_backend.sql",
  "202609100004_integrate_course_catalog.sql",
  "202609100005_harden_function_execute_grants.sql",
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

async function readSql(directory: "migrations" | "seeds", name: string) {
  return readFile(resolve(process.cwd(), "supabase", directory, name), "utf8");
}

async function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
  userId?: string,
): Promise<Attempt> {
  await database.exec(`
    select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);
    set role ${role};
  `);
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function asUser(userId: string, sql: string) {
  return asRole("authenticated", sql, userId);
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
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);

  for (const migration of MIGRATIONS) {
    await database.exec(await readSql("migrations", migration));
  }

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${DAVE}', 'dave@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now());
    insert into public.profiles (id, display_name, major, grad_year) values
      ('${ALICE}', 'Alice', 'Computer Science', 2027),
      ('${BOB}', 'Bob', 'Mathematics', 2028),
      ('${CAROL}', 'Carol', 'Physics', 2027),
      ('${DAVE}', 'Dave', 'Economics', 2028);
  `);
  await database.exec(await readSql("seeds", "issue-13-test00.sql"));
});

afterAll(async () => {
  await database?.close();
});

describe("phase-one full-chain integration", () => {
  it("applies every migration and creates only the two exact TEST00 fixtures", async () => {
    const fixtures = await database.query(`
      select id::text, school_id, code, title, term
      from public.courses
      where code_normalized = 'TEST00'
      order by school_id
    `);

    expect(fixtures.rows).toEqual([
      {
        id: "13000000-0000-4000-8000-000000000002",
        school_id: "umich",
        code: "TEST00",
        title: "测试00-测试课程",
        term: "2026-fall",
      },
      {
        id: "13000000-0000-4000-8000-000000000001",
        school_id: "uw-madison",
        code: "TEST00",
        title: "测试00-测试课程",
        term: "2026-fall",
      },
    ]);
  });

  it("keeps the final anonymous, authenticated, backend, and Realtime boundaries closed", async () => {
    const anonymousFunctions = await database.query<{ proname: string }>(`
      select procedure.proname
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', procedure.oid, 'execute')
      order by procedure.proname
    `);
    expect(anonymousFunctions.rows).toEqual([
      { proname: "enabled_school_id_for_email_domain" },
    ]);

    for (const sql of [
      `select public.members_are_blocked('${ALICE}', '${BOB}')`,
      "select public.consume_friend_rate_limit('friend_request')",
      "select * from public.eligible_direct_message_cleanup(clock_timestamp())",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    ]) {
      expect((await asUser(ALICE, sql)).ok).toBe(false);
    }

    const backendPreview = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    expect(backendPreview.ok).toBe(true);

    const publication = await database.query(`
      select schemaname, tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'messages'
    `);
    expect(publication.rows).toEqual([
      { schemaname: "public", tablename: "messages" },
    ]);
  });

  it("runs isolated TEST00 join, chat, member-list, and leave journeys for both schools", async () => {
    const courses = await database.query<{
      id: string;
      school_id: string;
      conversation_id: string;
    }>(`
      select course.id::text, course.school_id, link.conversation_id::text
      from public.courses course
      join public.course_conversations link on link.course_id = course.id
      where course.code_normalized = 'TEST00'
      order by course.school_id
    `);
    const michigan = courses.rows[0];
    const wisconsin = courses.rows[1];

    for (const [memberId, courseId] of [
      [ALICE, wisconsin.id],
      [BOB, wisconsin.id],
      [CAROL, michigan.id],
      [DAVE, michigan.id],
    ]) {
      const joined = await asUser(
        memberId,
        `insert into public.course_members (course_id) values ('${courseId}')`,
      );
      expect(joined.ok, JSON.stringify(joined)).toBe(true);
    }

    const wisconsinMessage = await asUser(
      ALICE,
      `insert into public.messages (conversation_id, body)
       values ('${wisconsin.conversation_id}', 'Wisconsin hello')`,
    );
    const michiganMessage = await asUser(
      CAROL,
      `insert into public.messages (conversation_id, body)
       values ('${michigan.conversation_id}', 'Michigan hello')`,
    );
    expect(wisconsinMessage.ok).toBe(true);
    expect(michiganMessage.ok).toBe(true);

    const wisconsinHistory = await asUser(
      BOB,
      `select body from public.messages
       where conversation_id = '${wisconsin.conversation_id}'`,
    );
    const michiganMembers = await asUser(
      DAVE,
      `select user_id::text from public.conversation_members
       where conversation_id = '${michigan.conversation_id}' order by user_id`,
    );
    const crossSchoolHistory = await asUser(
      CAROL,
      `select body from public.messages
       where conversation_id = '${wisconsin.conversation_id}'`,
    );
    expect(wisconsinHistory.ok && wisconsinHistory.rows).toEqual([
      { body: "Wisconsin hello" },
    ]);
    expect(michiganMembers.ok && michiganMembers.rows).toEqual([
      { user_id: CAROL },
      { user_id: DAVE },
    ]);
    expect(crossSchoolHistory.ok && crossSchoolHistory.rows).toEqual([]);

    const incompleteSearch = await asUser(
      INCOMPLETE,
      "select id from public.courses",
    );
    const incompleteJoin = await asUser(
      INCOMPLETE,
      `insert into public.course_members (course_id) values ('${wisconsin.id}')`,
    );
    const forgedMember = await asUser(
      ALICE,
      `insert into public.course_members (course_id, user_id)
       values ('${wisconsin.id}', '${CAROL}')`,
    );
    const memberCreatedCourse = await asUser(
      ALICE,
      `insert into public.courses (school_id, code, title, term)
       values ('uw-madison', 'FORGED 1', 'Forged', '2026-fall')`,
    );
    expect(incompleteSearch.ok && incompleteSearch.rows).toEqual([]);
    expect(incompleteJoin.ok).toBe(false);
    expect(forgedMember.ok).toBe(false);
    expect(memberCreatedCourse.ok).toBe(false);

    for (const [memberId, courseId] of [
      [ALICE, wisconsin.id],
      [BOB, wisconsin.id],
      [CAROL, michigan.id],
      [DAVE, michigan.id],
    ]) {
      const left = await asUser(
        memberId,
        `delete from public.course_members where course_id = '${courseId}'`,
      );
      expect(left.ok, JSON.stringify(left)).toBe(true);
    }
  });

  it("keeps one social journey consistent from discovery through cleanup and re-adding", async () => {
    const discovered = await asUser(
      ALICE,
      "select result_status, member_id::text from public.find_member_by_email('  BOB@WISC.EDU  ')",
    );
    const crossSchool = await asUser(
      ALICE,
      "select result_status from public.find_member_by_email('carol@umich.edu')",
    );
    const incomplete = await asUser(
      INCOMPLETE,
      `select result_status from public.send_friend_request('${BOB}', 'hello')`,
    );
    expect(discovered.ok && discovered.rows).toEqual([
      { result_status: "found", member_id: BOB },
    ]);
    expect(JSON.stringify(discovered)).not.toContain("bob@wisc.edu");
    expect(crossSchool.ok && crossSchool.rows).toEqual([
      { result_status: "not_found" },
    ]);
    expect(incomplete.ok && incomplete.rows).toEqual([
      { result_status: "onboarding_required" },
    ]);

    const requested = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'first contact')`,
    );
    const requestId = requested.ok ? String(requested.rows[0].request_id) : "";
    const forgedAcceptance = await asUser(
      ALICE,
      `select result_status from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    const accepted = await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    const conversationId = accepted.ok
      ? String(accepted.rows[0].conversation_id)
      : "";
    expect(forgedAcceptance.ok && forgedAcceptance.rows).toEqual([
      { result_status: "not_recipient" },
    ]);
    expect(accepted.ok && accepted.rows).toEqual([
      { result_status: "accepted", conversation_id: conversationId },
    ]);

    const firstHistory = await asUser(
      BOB,
      `select body from public.list_direct_messages('${conversationId}')`,
    );
    expect(firstHistory.ok && firstHistory.rows).toEqual([
      { body: "first contact" },
    ]);

    const note = await asUser(
      ALICE,
      `select public.set_friend_note('${BOB}', 'Study buddy') as status`,
    );
    const hidden = await asUser(
      ALICE,
      `select public.set_friend_hidden('${BOB}', true) as status`,
    );
    expect(note.ok && note.rows).toEqual([{ status: "saved" }]);
    expect(hidden.ok && hidden.rows).toEqual([{ status: "saved" }]);

    const sent = await asUser(
      BOB,
      `select * from public.send_direct_message(
        '${conversationId}', '<script>alert(1)</script> https://example.com'
      )`,
    );
    const messageId = sent.ok ? String(sent.rows[0].message_id) : "";
    const unread = await asUser(
      ALICE,
      "select * from public.get_direct_unread_counts()",
    );
    expect(sent.ok && sent.rows[0].result_status).toBe("sent");
    expect(unread.ok && unread.rows).toEqual([
      { visible_unread: 0, hidden_unread: 1 },
    ]);

    const blocked = await asUser(
      ALICE,
      `select public.set_member_blocked('${BOB}', true) as status`,
    );
    const blockedAliceSend = await asUser(
      ALICE,
      `select result_status from public.send_direct_message('${conversationId}', 'blocked')`,
    );
    const blockedBobSend = await asUser(
      BOB,
      `select result_status from public.send_direct_message('${conversationId}', 'blocked')`,
    );
    expect(blocked.ok && blocked.rows).toEqual([{ status: "saved" }]);
    expect(blockedAliceSend.ok && blockedAliceSend.rows).toEqual([
      { result_status: "not_allowed" },
    ]);
    expect(blockedBobSend.ok && blockedBobSend.rows).toEqual([
      { result_status: "not_allowed" },
    ]);
    await asUser(
      ALICE,
      `select public.set_member_blocked('${BOB}', false)`,
    );

    const read = await asUser(
      ALICE,
      `select public.mark_direct_conversation_read('${conversationId}', ${messageId}) as status`,
    );
    const reported = await asUser(
      ALICE,
      `select * from public.create_behavior_report(
        'message', '${messageId}', 'harassment', 'preserve this evidence'
      )`,
    );
    expect(read.ok && read.rows).toEqual([{ status: "updated" }]);
    expect(reported.ok && reported.rows[0].result_status).toBe("created");

    await asUser(
      ALICE,
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
    );
    const afterOneClear = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp() + interval '1000 hours', 100)",
    );
    const executeAfterOneClear = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(100)",
    );
    expect(afterOneClear.ok && afterOneClear.rows[0].candidate_count).toBe(0);
    expect(
      executeAfterOneClear.ok && executeAfterOneClear.rows[0].deleted_count,
    ).toBe(0);

    await asUser(
      BOB,
      `select public.clear_direct_conversation('${conversationId}', ${messageId})`,
    );
    const beforeRetention = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    expect(beforeRetention.ok && beforeRetention.rows[0].candidate_count).toBe(0);

    await database.exec(`
      update public.direct_message_cleanup_eligibility
      set eligible_since = clock_timestamp() - interval '721 hours'
      where conversation_id = '${conversationId}'
    `);
    const preview = await asRole(
      "service_role",
      "select * from public.preview_direct_message_cleanup(clock_timestamp(), 100)",
    );
    const previewIds = preview.ok
      ? (preview.rows[0].message_ids as unknown[]).map(String)
      : [];
    expect(previewIds).not.toContain(messageId);

    const executed = await asRole(
      "service_role",
      "select * from public.run_direct_message_cleanup(100)",
    );
    const deletedIds = executed.ok
      ? (executed.rows[0].message_ids as unknown[]).map(String)
      : [];
    expect(deletedIds).toEqual(previewIds);

    const removed = await asUser(
      ALICE,
      `select public.remove_friend('${BOB}') as status`,
    );
    expect(removed.ok && removed.rows).toEqual([{ status: "removed" }]);
    const requestedAgain = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'welcome back')`,
    );
    const secondRequestId = requestedAgain.ok
      ? String(requestedAgain.rows[0].request_id)
      : "";
    const acceptedAgain = await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${secondRequestId}', 'accept')`,
    );
    expect(acceptedAgain.ok && acceptedAgain.rows).toEqual([
      { result_status: "accepted", conversation_id: conversationId },
    ]);

    const restoredHistory = await asUser(
      ALICE,
      `select body from public.list_direct_messages('${conversationId}')`,
    );
    const requestHistory = await asUser(
      ALICE,
      "select status from public.list_friend_requests() order by created_at, request_id",
    );
    expect(restoredHistory.ok && restoredHistory.rows).toEqual([
      { body: "welcome back" },
    ]);
    expect(requestHistory.ok && requestHistory.rows).toEqual([
      { status: "accepted" },
      { status: "accepted" },
    ]);
  });
});
