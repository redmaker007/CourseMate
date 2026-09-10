import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 课程目录与课程流程的集成测试。
 *
 * 这是唯一一个按**真实顺序**跑完全部 migration 的测试。其余测试各自只跑到自己
 * 需要的那一步——足以验证各自的功能，但证明不了两条独立开发的线（课程目录与
 * 统一会话 / 课程流程）叠在一起还能工作。合并时出过迁移时间戳撞号、当前学期存了
 * 两份这类问题，所以这里专门守着完整链路。
 */

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
] as const;

const ALICE = "11111111-1111-4111-8111-111111111111"; // wisc，已完成 onboarding
const CAROL = "33333333-3333-4333-8333-333333333333"; // umich，已完成 onboarding
const INCOMPLETE = "55555555-5555-4555-8555-555555555555"; // wisc，没有 Profile

// 目录允许、courses 不允许的两种数据：用来验证物化是跳过而不是截断
const LONG_TITLE = "T".repeat(130);
const LONG_CODE = "ACCTISLONGSUBJECT 1000"; // 22 字

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

type Materialized = {
  materialized_term: string;
  created_count: number;
  existing_count: number;
  invalid_count: number;
};

let database: PGlite;

async function applyMigration(name: string) {
  const sql = await readFile(
    resolve(process.cwd(), "supabase/migrations", name),
    "utf8",
  );
  await database.exec(sql);
}

async function run(sql: string): Promise<Attempt> {
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function asUser(userId: string, sql: string): Promise<Attempt> {
  await database.exec(
    `set role authenticated;
     select set_config('request.jwt.claim.sub', '${userId}', false);`,
  );
  return run(sql);
}

/** 以导入脚本所用的 service_role 身份执行。先清掉上一个用户残留的身份声明。 */
async function asServiceRole(sql: string): Promise<Attempt> {
  await database.exec(
    `select set_config('request.jwt.claim.sub', '', false);
     set role service_role;`,
  );
  return run(sql);
}

async function count(userId: string, sql: string): Promise<number> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return Number((result.rows[0] as { n: number }).n);
}

async function materialize(school: string): Promise<Materialized> {
  const result = await asServiceRole(
    `select * from public.materialize_catalog_courses('${school}')`,
  );
  if (!result.ok) throw new Error(result.error);
  return result.rows[0] as Materialized;
}

async function courseId(code: string, term: string) {
  const rows = await database.query<{ id: string }>(
    `select id::text from public.courses
     where school_id = 'uw-madison' and code = '${code}' and term = '${term}'`,
  );
  return rows.rows[0]?.id;
}

async function conversationArchivedAt(course: string) {
  const rows = await database.query<{ archived_at: string | null }>(
    `select conversations.archived_at
     from public.course_conversations links
     join public.conversations conversations on conversations.id = links.conversation_id
     where links.course_id = '${course}'`,
  );
  return rows.rows[0];
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

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'),
      ('${CAROL}', 'Carol');

    insert into public.course_catalog (school_id, code, subject, number, title) values
      ('uw-madison', 'ACCT I S 100', 'ACCT I S', '100', 'Introductory Financial Accounting'),
      ('uw-madison', 'ACCT I S 211', 'ACCT I S', '211', '${LONG_TITLE}'),
      ('uw-madison', '${LONG_CODE}', 'ACCTISLONGSUBJECT', '1000', 'Long Code'),
      ('umich', 'EECS 280', 'EECS', '280', 'Programming and Introductory Data Structures');
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("完整迁移链", () => {
  it("十个 migration 按真实顺序跑通，两条线的表都在", async () => {
    const tables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('course_catalog', 'conversations', 'school_term_settings', 'friendships')
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "conversations",
      "course_catalog",
      "friendships",
      "school_term_settings",
    ]);
  });

  it("学期只有 school_term_settings 一个来源，schools 上没有第二份", async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'schools'
         and column_name = 'current_term'`,
    );
    expect(columns.rows).toEqual([]);
  });
});

describe("课程目录的读取门槛", () => {
  it("已完成 onboarding 的学生能读本校目录", async () => {
    expect(
      await count(ALICE, "select count(*)::int as n from public.course_catalog"),
    ).toBe(3);
  });

  it("未完成 onboarding 的学生读不到目录（ADR-0004）", async () => {
    expect(
      await count(
        INCOMPLETE,
        "select count(*)::int as n from public.course_catalog",
      ),
    ).toBe(0);
  });

  it("读不到外校目录", async () => {
    expect(
      await count(
        CAROL,
        `select count(*)::int as n from public.course_catalog
         where school_id = 'uw-madison'`,
      ),
    ).toBe(0);
    expect(
      await count(CAROL, "select count(*)::int as n from public.course_catalog"),
    ).toBe(1);
  });
});

describe("物化目录为可加入的课程", () => {
  it("学生不能调用物化函数，也没有因此产生任何课程", async () => {
    const attempt = await asUser(
      ALICE,
      "select * from public.materialize_catalog_courses('uw-madison')",
    );
    expect(attempt.ok).toBe(false);
    expect(await courseId("ACCT I S 100", "2026-fall")).toBeUndefined();
  });

  it("合规的行建成课程，不合规的跳过并计数，不截断", async () => {
    expect(await materialize("uw-madison")).toEqual({
      materialized_term: "2026-fall",
      created_count: 1,
      existing_count: 0,
      invalid_count: 2,
    });

    expect(await courseId("ACCT I S 100", "2026-fall")).toBeTruthy();
    const truncated = await database.query<{ n: number }>(
      `select count(*)::int as n from public.courses
       where school_id = 'uw-madison' and code in ('ACCT I S 211', '${LONG_CODE}')`,
    );
    expect(truncated.rows[0].n).toBe(0);
  });

  it("重复物化是幂等的", async () => {
    expect(await materialize("uw-madison")).toEqual({
      materialized_term: "2026-fall",
      created_count: 0,
      existing_count: 1,
      invalid_count: 2,
    });
  });

  it("物化出的课自动配好未归档的课程会话", async () => {
    const course = await courseId("ACCT I S 100", "2026-fall");
    expect(await conversationArchivedAt(course!)).toEqual({
      archived_at: null,
    });
  });

  it("学生能加入物化出的课，并自动成为会话成员", async () => {
    const course = await courseId("ACCT I S 100", "2026-fall");
    const joined = await asUser(
      ALICE,
      `insert into public.course_members (course_id) values ('${course}')
       returning course_id`,
    );
    expect(joined.ok).toBe(true);

    const membership = await database.query<{ n: number }>(
      `select count(*)::int as n
       from public.conversation_members members
       join public.course_conversations links
         on links.conversation_id = members.conversation_id
       where links.course_id = '${course}' and members.user_id = '${ALICE}'`,
    );
    expect(membership.rows[0].n).toBe(1);
  });

  it("没设当前学期的学校拒绝物化，而不是猜一个学期", async () => {
    await database.exec(`
      insert into public.schools (id, name_zh, name_en)
      values ('test-noterm', '无学期测试校', 'No Term University');
      insert into public.course_catalog (school_id, code, subject, number, title)
      values ('test-noterm', 'ZZ 101', 'ZZ', '101', 'Some Course');
    `);
    const attempt = await asServiceRole(
      "select * from public.materialize_catalog_courses('test-noterm')",
    );
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toContain("尚未设置当前学期");
  });
});

describe("学期切换", () => {
  it("切换后重新物化：旧学期会话归档、新学期建出新课、历史成员保留", async () => {
    const oldCourse = await courseId("ACCT I S 100", "2026-fall");

    await database.exec(
      `update public.school_term_settings set current_term = '2027-spring'
       where school_id = 'uw-madison'`,
    );
    expect((await conversationArchivedAt(oldCourse!))?.archived_at).not.toBeNull();

    expect(await materialize("uw-madison")).toEqual({
      materialized_term: "2027-spring",
      created_count: 1,
      existing_count: 0,
      invalid_count: 2,
    });

    const newCourse = await courseId("ACCT I S 100", "2027-spring");
    expect(newCourse).toBeTruthy();
    expect(await conversationArchivedAt(newCourse!)).toEqual({
      archived_at: null,
    });

    const history = await database.query<{ n: number }>(
      `select count(*)::int as n from public.course_members
       where course_id = '${oldCourse}' and user_id = '${ALICE}'`,
    );
    expect(history.rows[0].n).toBe(1);
  });
});
