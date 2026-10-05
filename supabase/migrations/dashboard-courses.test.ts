import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 大厅「我的课程」合并读取（202610050001）。
 *
 * get_dashboard_courses 把「当前学期 → 我的课程 → 会话关联 → 归档与成员数」四轮请求
 * 合成一次调用。这里用测试里复刻的旧逻辑（逐表按调用者的 RLS 查询）逐项对照，
 * 确认结果一致、可见范围没有放宽。按真实顺序跑完全部 migration。
 */

const ALICE = "d1111111-1111-4111-8111-111111111111"; // wisc，加入多门课
const BOB = "d2222222-2222-4222-8222-222222222222"; // wisc，与 Alice 同班
const CAROL = "d3333333-3333-4333-8333-333333333333"; // umich
const NOBODY = "d4444444-4444-4444-8444-444444444444"; // wisc，没加入任何课

type Row = Record<string, unknown>;
type Attempt = { ok: true; rows: Row[] } | { ok: false; error: string };

let database: PGlite;

async function run(sql: string): Promise<Attempt> {
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Row[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function asUser(userId: string | null, sql: string): Promise<Attempt> {
  await database.exec(
    `set role authenticated;
     select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`,
  );
  return run(sql);
}

async function rows(userId: string | null, sql: string): Promise<Row[]> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

const idList = (values: unknown[]) => values.map((value) => `'${value}'`).join(", ");

type Dashboard = {
  course_id: string;
  school_id: string;
  code: string;
  title: string;
  term: string;
  conversation_id: string;
  archived: boolean;
  member_count: number;
};

const byCourse = (left: Dashboard, right: Dashboard) =>
  left.course_id.localeCompare(right.course_id);

const viaFunction = async (userId: string | null, school: string) =>
  (
    (await rows(
      userId,
      `select * from public.get_dashboard_courses('${school}')`,
    )) as Dashboard[]
  ).sort(byCourse);

/** 合并前 getDashboardCourses 的逻辑：逐表按调用者的 RLS 查询，在应用层拼装。 */
async function viaLegacyQueries(userId: string, school: string): Promise<Dashboard[]> {
  const [term] = await rows(
    userId,
    `select current_term from public.school_term_settings where school_id = '${school}'`,
  );
  if (!term) return [];
  const memberships = await rows(
    userId,
    `select course_id from public.course_members where user_id = '${userId}'`,
  );
  if (memberships.length === 0) return [];
  const courseIds = idList(memberships.map((row) => row.course_id));
  const courses = await rows(
    userId,
    `select id, school_id, code, title, term from public.courses
     where school_id = '${school}' and id in (${courseIds})`,
  );
  const links = await rows(
    userId,
    `select course_id, conversation_id from public.course_conversations
     where course_id in (${courseIds})`,
  );
  if (links.length === 0) return [];
  const conversationIds = idList(links.map((row) => row.conversation_id));
  const conversations = await rows(
    userId,
    `select id, archived_at from public.conversations where id in (${conversationIds})`,
  );
  const memberRows = await rows(
    userId,
    `select conversation_id from public.conversation_members
     where conversation_id in (${conversationIds})`,
  );

  const linkByCourse = new Map(links.map((row) => [row.course_id, row.conversation_id]));
  const archiveByConversation = new Map(
    conversations.map((row) => [row.id, row.archived_at]),
  );
  const countByConversation = new Map<unknown, number>();
  for (const row of memberRows) {
    countByConversation.set(
      row.conversation_id,
      (countByConversation.get(row.conversation_id) ?? 0) + 1,
    );
  }

  return courses
    .flatMap((row) => {
      const conversationId = linkByCourse.get(row.id);
      if (!conversationId) return [];
      return [
        {
          course_id: row.id as string,
          school_id: row.school_id as string,
          code: row.code as string,
          title: row.title as string,
          term: row.term as string,
          conversation_id: conversationId as string,
          archived:
            row.term !== term.current_term ||
            archiveByConversation.get(conversationId) !== null,
          member_count: countByConversation.get(conversationId) ?? 0,
        },
      ];
    })
    .sort(byCourse);
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
    -- Supabase 默认授予；security invoker 的 SQL 函数在调用时按调用者解析 auth.uid()，
    -- 需要这项授权（已在真实项目上核对）。
    grant usage on schema auth to anon, authenticated, service_role;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);

  const migrations = (await readdir(resolve(process.cwd(), "supabase/migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) {
    await database.exec(
      await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"),
    );
  }

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${NOBODY}', 'nobody@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'), ('${BOB}', 'Bob'),
      ('${CAROL}', 'Carol'), ('${NOBODY}', 'Nobody');

    insert into public.courses (school_id, code, title, term) values
      ('uw-madison', 'CS 100', 'Intro', '2026-fall'),
      ('uw-madison', 'CS 200', 'Archived chat', '2026-fall'),
      ('uw-madison', 'OLD 1', 'Old term', '2025-fall'),
      ('uw-madison', 'NOLINK 1', 'No conversation link', '2026-fall'),
      ('umich', 'EECS 280', 'Michigan', '2026-fall');
  `);

  // 加入课程走真实路径：以成员身份插入，由触发器惰性创建会话。
  const course = async (code: string) =>
    (
      await database.query<{ id: string }>(
        `select id::text from public.courses where code = '${code}'`,
      )
    ).rows[0].id;
  for (const [user, code] of [
    [ALICE, "CS 100"],
    [BOB, "CS 100"],
    [ALICE, "CS 200"],
    [CAROL, "EECS 280"],
  ] as const) {
    const joined = await asUser(
      user,
      `insert into public.course_members (course_id) values ('${await course(code)}')`,
    );
    if (!joined.ok) throw new Error(joined.error);
  }

  // 往期课程：学期不是当前学期；会话已归档；没有会话关联的课程。
  await database.exec(`
    insert into public.course_members (course_id, user_id)
    select id, '${ALICE}' from public.courses where code in ('OLD 1', 'NOLINK 1');
    update public.conversations set archived_at = now()
    where id = (
      select conversation_id from public.course_conversations links
      join public.courses courses on courses.id = links.course_id
      where courses.code = 'CS 200'
    );
    delete from public.course_conversations
    where course_id = (select id from public.courses where code = 'NOLINK 1');

    -- 没有设置当前学期的学校。
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('noterm-u', '无学期大学', 'No Term University', true);
    insert into public.courses (school_id, code, title, term)
    values ('noterm-u', 'NT 1', 'No term', '2026-fall');
    insert into public.course_members (course_id, user_id)
    select id, '${ALICE}' from public.courses where code = 'NT 1';
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("get_dashboard_courses", () => {
  it("与合并前逐表查询的结果逐项一致", async () => {
    for (const [userId, school] of [
      [ALICE, "uw-madison"],
      [BOB, "uw-madison"],
      [CAROL, "umich"],
      [NOBODY, "uw-madison"],
      [ALICE, "umich"],
      [CAROL, "uw-madison"],
      [ALICE, "noterm-u"],
    ] as const) {
      expect(await viaFunction(userId, school), `${userId} @ ${school}`).toEqual(
        await viaLegacyQueries(userId, school),
      );
    }
  });

  it("返回当前学期课程、往期课程、成员数，并排除没有会话关联的课程", async () => {
    const result = await viaFunction(ALICE, "uw-madison");
    const view = Object.fromEntries(
      result.map((row) => [row.code, { archived: row.archived, members: row.member_count }]),
    );

    expect(view).toEqual({
      "CS 100": { archived: false, members: 2 },
      "CS 200": { archived: true, members: 1 }, // 会话已归档
      "OLD 1": { archived: true, members: 1 }, // 学期不是当前学期
    });
    expect(result.map((row) => row.code)).not.toContain("NOLINK 1");
  });

  it("该学校没有设置当前学期时返回零行", async () => {
    expect(await viaFunction(ALICE, "noterm-u")).toEqual([]);
  });

  it("没有加入任何课程时返回零行", async () => {
    expect(await viaFunction(NOBODY, "uw-madison")).toEqual([]);
  });

  it("传别的学校只会得到该学校的课程，不会混进其他学校的课", async () => {
    expect(await viaFunction(ALICE, "umich")).toEqual([]);
    expect((await viaFunction(CAROL, "umich")).map((row) => row.code)).toEqual(["EECS 280"]);
  });

  it("没有登录身份时返回零行", async () => {
    expect(await viaFunction(null, "uw-madison")).toEqual([]);
  });

  it("显式按 auth.uid() 过滤：即使调用者绕过 RLS，也只返回自己的课程", async () => {
    // service_role 带 bypassrls。去掉 auth.uid() 过滤，它会拿到所有人的选课。
    await database.exec(
      `set role service_role;
       select set_config('request.jwt.claim.sub', '${BOB}', false);`,
    );
    const result = await run(
      "select code from public.get_dashboard_courses('uw-madison') order by 1",
    );

    expect(result).toEqual({ ok: true, rows: [{ code: "CS 100" }] });
  });

  it("只有已登录用户可以执行，未登录角色不行", async () => {
    await database.exec("set role anon;");
    const anon = await run("select * from public.get_dashboard_courses('uw-madison')");
    expect(anon.ok).toBe(false);

    const authenticated = await asUser(
      ALICE,
      "select * from public.get_dashboard_courses('uw-madison')",
    );
    expect(authenticated.ok).toBe(true);
  });
});
