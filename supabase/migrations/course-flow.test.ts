import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CAROL = "33333333-3333-4333-8333-333333333333";
const INCOMPLETE = "55555555-5555-4555-8555-555555555555";

const MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090002_profile_onboarding.sql",
  "202609100001_unified_conversation_core.sql",
] as const;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;

async function applyMigration(name: string) {
  const sql = await readFile(
    resolve(process.cwd(), "supabase/migrations", name),
    "utf8",
  );
  await database.exec(sql);
}

async function asUser(userId: string, sql: string): Promise<Attempt> {
  await database.exec(
    `set role authenticated;
     select set_config('request.jwt.claim.sub', '${userId}', false);`,
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

async function hasCourseConversation(courseId: string) {
  const result = await database.query<{ n: number }>(
    `select count(*)::int as n from public.course_conversations where course_id = '${courseId}'`,
  );
  return result.rows[0].n > 0;
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
    create function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
  `);
  for (const migration of MIGRATIONS) await applyMigration(migration);
  await applyMigration("202609140001_lazy_course_conversation_creation.sql");

  await database.exec(`
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('umich', '密歇根大学', 'University of Michigan', true);
    insert into public.school_email_domains (domain, school_id)
    values ('umich.edu', 'umich');

    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'),
      ('${CAROL}', 'Carol');

    insert into public.courses (school_id, code, title, term, created_by) values
      ('uw-madison', 'TEST00', '测试00-测试课程', '2026-fall', '${ALICE}'),
      ('umich', 'TEST00', '测试00-测试课程', '2026-fall', '${CAROL}'),
      ('uw-madison', 'CS 2025', 'Archived Course', '2025-fall', '${ALICE}');
    insert into public.course_members (course_id, user_id)
    select id, '${ALICE}' from public.courses where code = 'CS 2025';
  `);

  await applyMigration("202609100002_course_flow.sql");
});

afterAll(async () => {
  await database?.close();
});

describe("课程目录准入", () => {
  it("显式提供两校当前学期，并禁止普通成员创建课程", async () => {
    const madisonTerm = await asUser(
      ALICE,
      "select current_term from public.school_term_settings",
    );
    const michiganTerm = await asUser(
      CAROL,
      "select current_term from public.school_term_settings",
    );
    expect(madisonTerm.ok && madisonTerm.rows).toEqual([
      { current_term: "2026-fall" },
    ]);
    expect(michiganTerm.ok && michiganTerm.rows).toEqual([
      { current_term: "2026-fall" },
    ]);

    const forgedCourse = await asUser(
      ALICE,
      `insert into public.courses (school_id, code, title, term)
       values ('uw-madison', 'FORGED 1', 'Not catalog data', '2026-fall')`,
    );
    expect(forgedCourse.ok).toBe(false);

    const changedCourse = await asUser(
      ALICE,
      `update public.courses set title = 'member edit'
       where school_id = 'uw-madison' and code = 'TEST00'`,
    );
    expect(changedCourse.ok).toBe(false);
  });

  it("只能查看和加入本校当前学期课程，成员 ID 不能伪造", async () => {
    const visible = await asUser(
      ALICE,
      "select school_id, code, term from public.courses order by code",
    );
    expect(visible.ok && visible.rows).toEqual([
      { school_id: "uw-madison", code: "CS 2025", term: "2025-fall" },
      { school_id: "uw-madison", code: "TEST00", term: "2026-fall" },
    ]);

    const madisonCourse = await database.query<{ id: string }>(
      "select id::text from public.courses where school_id = 'uw-madison' and code = 'TEST00'",
    );
    const michiganCourse = await database.query<{ id: string }>(
      "select id::text from public.courses where school_id = 'umich' and code = 'TEST00'",
    );

    expect(await hasCourseConversation(madisonCourse.rows[0].id)).toBe(false);

    const joined = await asUser(
      ALICE,
      `insert into public.course_members (course_id)
       values ('${madisonCourse.rows[0].id}')`,
    );
    expect(joined.ok).toBe(true);

    const crossSchool = await asUser(
      ALICE,
      `insert into public.course_members (course_id)
       values ('${michiganCourse.rows[0].id}')`,
    );
    expect(crossSchool.ok).toBe(false);

    const forgedMember = await asUser(
      ALICE,
      `insert into public.course_members (course_id, user_id)
       values ('${madisonCourse.rows[0].id}', '${CAROL}')`,
    );
    expect(forgedMember.ok).toBe(false);

    const conversationMembership = await database.query<{ n: number }>(
      `select count(*)::int as n
       from public.conversation_members members
       join public.course_conversations links
         on links.conversation_id = members.conversation_id
       where links.course_id = '${madisonCourse.rows[0].id}'
         and members.user_id = '${ALICE}'`,
    );
    expect(conversationMembership.rows).toEqual([{ n: 1 }]);
  });

  it("未完成 onboarding 的成员不能搜索或加入课程", async () => {
    const visible = await asUser(INCOMPLETE, "select id from public.courses");
    expect(visible.ok && visible.rows).toEqual([]);

    const course = await database.query<{ id: string }>(
      "select id::text from public.courses where school_id = 'uw-madison' and code = 'TEST00'",
    );
    const joined = await asUser(
      INCOMPLETE,
      `insert into public.course_members (course_id)
       values ('${course.rows[0].id}')`,
    );
    expect(joined.ok).toBe(false);
  });

  it("归档课程保留历史和成员列表，但不能发消息或退出", async () => {
    const archived = await database.query<{
      conversation_id: string;
      archived_at: string | null;
    }>(
      `select links.conversation_id::text, conversations.archived_at::text
       from public.course_conversations links
       join public.conversations conversations on conversations.id = links.conversation_id
       join public.courses courses on courses.id = links.course_id
       where courses.code = 'CS 2025'`,
    );
    expect(archived.rows[0].archived_at).not.toBeNull();
    const conversationId = archived.rows[0].conversation_id;

    await database.exec(
      `insert into public.messages (conversation_id, sender_id, body)
       values ('${conversationId}', '${ALICE}', 'historical message')`,
    );

    const history = await asUser(
      ALICE,
      `select body from public.messages where conversation_id = '${conversationId}'`,
    );
    const members = await asUser(
      ALICE,
      `select user_id::text from public.conversation_members
       where conversation_id = '${conversationId}'`,
    );
    expect(history.ok && history.rows).toEqual([{ body: "historical message" }]);
    expect(members.ok && members.rows).toEqual([{ user_id: ALICE }]);

    const sent = await asUser(
      ALICE,
      `insert into public.messages (conversation_id, body)
       values ('${conversationId}', 'new message')`,
    );
    const left = await asUser(
      ALICE,
      `delete from public.course_members
       where course_id = (select id from public.courses where code = 'CS 2025')`,
    );
    expect(sent.ok).toBe(false);
    expect(left.ok && left.rows).toEqual([]);
    const membershipStillExists = await database.query<{ n: number }>(`
      select count(*)::int as n from public.course_members
      where course_id = (select id from public.courses where code = 'CS 2025')
        and user_id = '${ALICE}'
    `);
    expect(membershipStillExists.rows).toEqual([{ n: 1 }]);
  });

  it("runs the Michigan join, chat, member-list, isolation, and leave flow", async () => {
    const course = await database.query<{ id: string }>(`
      select courses.id::text
      from public.courses courses
      where courses.school_id = 'umich' and courses.code = 'TEST00'
    `);
    const { id: courseId } = course.rows[0];

    expect(await hasCourseConversation(courseId)).toBe(false);

    expect(
      (await asUser(
        CAROL,
        `insert into public.course_members (course_id) values ('${courseId}')`,
      )).ok,
    ).toBe(true);

    const conversation = await database.query<{ conversation_id: string }>(`
      select links.conversation_id::text
      from public.course_conversations links
      where links.course_id = '${courseId}'
    `);
    const { conversation_id: conversationId } = conversation.rows[0];

    expect(
      (await asUser(
        CAROL,
        `insert into public.messages (conversation_id, body)
         values ('${conversationId}', 'Michigan hello')`,
      )).ok,
    ).toBe(true);

    const ownHistory = await asUser(
      CAROL,
      `select body from public.messages where conversation_id = '${conversationId}'`,
    );
    const ownMembers = await asUser(
      CAROL,
      `select user_id::text from public.conversation_members
       where conversation_id = '${conversationId}'`,
    );
    const crossSchoolHistory = await asUser(
      ALICE,
      `select body from public.messages where conversation_id = '${conversationId}'`,
    );
    expect(ownHistory.ok && ownHistory.rows).toEqual([
      { body: "Michigan hello" },
    ]);
    expect(ownMembers.ok && ownMembers.rows).toEqual([{ user_id: CAROL }]);
    expect(crossSchoolHistory.ok && crossSchoolHistory.rows).toEqual([]);

    expect(
      (await asUser(
        CAROL,
        `delete from public.course_members where course_id = '${courseId}'`,
      )).ok,
    ).toBe(true);
    const remaining = await database.query<{ count: number }>(`
      select count(*)::int from public.course_members
      where course_id = '${courseId}' and user_id = '${CAROL}'
    `);
    expect(remaining.rows).toEqual([{ count: 0 }]);
  });

  it("archives conversations when the explicit current term advances", async () => {
    await database.exec(`
      update public.school_term_settings
      set current_term = '2027-spring'
      where school_id = 'uw-madison';
      insert into public.courses (school_id, code, title, term)
      values
        ('uw-madison', 'NEW 100', 'New current course', '2027-spring'),
        ('uw-madison', 'OLD 100', 'Imported archive', '2026-fall');
    `);

    const newCourse = await database.query<{ id: string }>(
      `select id::text from public.courses where school_id = 'uw-madison' and code = 'NEW 100'`,
    );
    const oldCourse = await database.query<{ id: string }>(
      `select id::text from public.courses where school_id = 'uw-madison' and code = 'OLD 100'`,
    );

    // 惰性建会话：刚插入、还没人加入的新课不会有课程会话，不管是不是当前学期
    expect(await hasCourseConversation(newCourse.rows[0].id)).toBe(false);
    expect(await hasCourseConversation(oldCourse.rows[0].id)).toBe(false);

    // TEST00（Madison）在之前的测试里已经有 ALICE 加入过，学期切换后应变为归档
    const testCourse = await database.query<{ id: string }>(
      `select id::text from public.courses where school_id = 'uw-madison' and code = 'TEST00'`,
    );
    expect(
      (await database.query<{ archived: boolean }>(`
        select conversations.archived_at is not null as archived
        from public.course_conversations links
        join public.conversations conversations on conversations.id = links.conversation_id
        where links.course_id = '${testCourse.rows[0].id}'
      `)).rows,
    ).toEqual([{ archived: true }]);

    // 学期切换之后才第一次加入的课，惰性建出的会话应当直接是未归档的——因为
    // course_members_insert_self 已经把"能加入"限定为当前学期课，不需要复刻旧的
    // 按学期比较逻辑
    expect(
      (await asUser(
        ALICE,
        `insert into public.course_members (course_id) values ('${newCourse.rows[0].id}')`,
      )).ok,
    ).toBe(true);
    expect(
      (await database.query<{ archived: boolean }>(`
        select conversations.archived_at is not null as archived
        from public.course_conversations links
        join public.conversations conversations on conversations.id = links.conversation_id
        where links.course_id = '${newCourse.rows[0].id}'
      `)).rows,
    ).toEqual([{ archived: false }]);

    // OLD 100 已经不是当前学期，RLS 会拒绝任何学生加入——在新模型下它永远不会
    // 产生会话，这是额外的好处：连"建出来但注定加入不了、只能一直挂着的会话"
    // 也不会再出现
    expect(await hasCourseConversation(oldCourse.rows[0].id)).toBe(false);
  });
});
