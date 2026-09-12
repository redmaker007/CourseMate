import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 全链路集成测试。
 *
 * 这是唯一一个按**真实顺序**跑完全部 migration 的测试。其余测试各自只跑到自己
 * 需要的那一步——足以验证各自的功能，但证明不了两条独立开发的线（课程目录与
 * 统一会话 / 课程流程）叠在一起还能工作。合并时出过迁移时间戳撞号、当前学期存了
 * 两份这类问题，所以这里专门守着完整链路。
 *
 * 测试桩复刻了 Supabase 的两类 default privileges：新表与**新函数**都会被单独授予
 * anon / authenticated。后者此前漏掉了，导致「revoke from public 收不回单独授权」
 * 这个问题在本地从未暴露。
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

const HARDENING = "202609100005_harden_function_execute_grants.sql";

/** 硬化之后新增的 migration。放进链路，下面的函数执行权枚举检查才覆盖得到它们。 */
const AFTER_HARDENING = ["202609100006_platform_admin.sql"] as const;

/** 唯一允许未登录用户执行的函数：登录页在登录前就要用它判断邮箱属于哪所学校。 */
const ANON_ALLOWED_FUNCTIONS = ["enabled_school_id_for_email_domain"];

const ALICE = "11111111-1111-4111-8111-111111111111"; // wisc，已完成 onboarding
const BOB = "22222222-2222-4222-8222-222222222222"; // wisc，已完成 onboarding
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

/** 修复 migration 之前，未登录用户能否执行内部辅助函数。用来证明测试确实复现了漏洞。 */
let membersAreBlockedExposedBeforeHardening: boolean;

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

async function asAnon(sql: string): Promise<Attempt> {
  await database.exec(
    `select set_config('request.jwt.claim.sub', '', false);
     set role anon;`,
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

async function anonCanExecute(signature: string): Promise<boolean> {
  const rows = await database.query<{ allowed: boolean }>(
    `select has_function_privilege('anon', '${signature}', 'execute') as allowed`,
  );
  return rows.rows[0].allowed;
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
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);

  for (const migration of MIGRATIONS) await applyMigration(migration);

  membersAreBlockedExposedBeforeHardening = await anonCanExecute(
    "public.members_are_blocked(uuid, uuid)",
  );

  await applyMigration(HARDENING);
  for (const migration of AFTER_HARDENING) await applyMigration(migration);

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'),
      ('${BOB}', 'Bob'),
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
  it("全部 migration 按真实顺序跑通，两条线的表都在", async () => {
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

describe("函数执行权", () => {
  it("修复前漏洞确实存在——证明测试环境真实复刻了 Supabase 的默认授权", () => {
    // 如果这条不成立，下面几条「修复后没有漏洞」的断言就可能只是在空转
    expect(membersAreBlockedExposedBeforeHardening).toBe(true);
  });

  it("未登录用户只能执行登录必需的那一个函数", async () => {
    // 按 pg_proc 枚举而不是写死列表：以后新加的函数忘了收回，这条会直接失败
    const executable = await database.query<{ proname: string }>(
      `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('anon', p.oid, 'execute')
       order by p.proname`,
    );
    expect(executable.rows.map((row) => row.proname)).toEqual(
      ANON_ALLOWED_FUNCTIONS,
    );
  });

  it("未登录用户实际调用受限函数会被拒绝", async () => {
    const attempt = await asAnon(
      `select public.can_access_course_conversation('00000000-0000-0000-0000-000000000000')`,
    );
    expect(attempt.ok).toBe(false);
  });

  it("内部辅助函数连已登录用户也调用不了——拉黑关系不再能被任意查询", async () => {
    const blocked = await asUser(
      ALICE,
      `select public.members_are_blocked('${BOB}', '${CAROL}')`,
    );
    expect(blocked.ok).toBe(false);

    const rateLimit = await asUser(
      ALICE,
      "select public.consume_friend_rate_limit('friend_request')",
    );
    expect(rateLimit.ok).toBe(false);
  });

  it("通过公开接口仍能间接用到内部辅助函数", async () => {
    // send_friend_request 在内部调用 members_are_blocked 与 consume_friend_rate_limit。
    // 以函数属主身份执行，所以收回调用者的执行权不应影响它。
    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'hello')`,
    );
    expect(sent.ok).toBe(true);
  });

  it("已登录用户仍能执行 RLS 策略依赖的函数", async () => {
    const onboarding = await asUser(
      ALICE,
      "select public.has_completed_onboarding() as done",
    );
    expect(onboarding.ok && onboarding.rows).toEqual([{ done: true }]);
  });

  it("以后新建的函数只要 revoke from public 就不再对客户端开放", async () => {
    await database.exec(`
      create function public._probe_default_privileges()
      returns integer language sql as $$ select 1 $$;
      revoke execute on function public._probe_default_privileges() from public;
    `);
    expect(await anonCanExecute("public._probe_default_privileges()")).toBe(
      false,
    );
    const authenticated = await database.query<{ allowed: boolean }>(
      `select has_function_privilege('authenticated',
         'public._probe_default_privileges()', 'execute') as allowed`,
    );
    expect(authenticated.rows[0].allowed).toBe(false);
    await database.exec("drop function public._probe_default_privileges();");
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

describe("Profile 保存", () => {
  // 好友后端把 profiles 的读取权限收窄成三列之后，upsert 被拒、新成员卡在
  // onboarding——上线后才发现，因为 onboarding 的测试只跑到它自己那一步 migration。
  // 这里按网站实际的写法（production-profile-service.ts）在完整链路上验证。
  const NEWCOMER = "66666666-6666-4666-8666-666666666666";

  it("新成员插入即完成 onboarding；已有资料时插入撞唯一约束，改走更新", async () => {
    await database.exec(
      `insert into auth.users (id, email, email_confirmed_at)
       values ('${NEWCOMER}', 'newcomer@wisc.edu', now())`,
    );

    expect(
      await asUser(
        NEWCOMER,
        `insert into public.profiles (id, display_name, major, grad_year)
         values ('${NEWCOMER}', 'Newcomer', 'Computer Science', 2028)`,
      ),
    ).toEqual({ ok: true, rows: [] });
    expect(
      await asUser(NEWCOMER, "select public.has_completed_onboarding() as done"),
    ).toEqual({ ok: true, rows: [{ done: true }] });

    const duplicate = await asUser(
      NEWCOMER,
      `insert into public.profiles (id, display_name, major, grad_year)
       values ('${NEWCOMER}', 'Again', null, null)`,
    );
    expect(duplicate.ok).toBe(false);
    expect(!duplicate.ok && duplicate.error).toMatch(/duplicate key/);

    expect(
      await asUser(
        NEWCOMER,
        `update public.profiles
         set display_name = 'Renamed', major = null, grad_year = null
         where id = '${NEWCOMER}'`,
      ),
    ).toEqual({ ok: true, rows: [] });
    expect(
      await asUser(
        NEWCOMER,
        "select display_name, major, grad_year from public.get_own_profile()",
      ),
    ).toEqual({
      ok: true,
      rows: [{ display_name: "Renamed", major: null, grad_year: null }],
    });
  });

  it("upsert 会被列级读取权限拒绝——不要把保存改回 upsert", async () => {
    expect(
      await asUser(
        ALICE,
        `insert into public.profiles (id, display_name, major, grad_year)
         values ('${ALICE}', 'Alice', null, null)
         on conflict (id) do update set
           display_name = excluded.display_name,
           major = excluded.major,
           grad_year = excluded.grad_year`,
      ),
    ).toEqual({ ok: false, error: "permission denied for table profiles" });
  });
});
