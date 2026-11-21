import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 搜索结果的成员数（202611210001）。
 *
 * 学生加入课程前按 RLS 数不到别人的选课行，get_course_member_counts 只返回
 * (课程 id, 人数)。这里确认：人数正确、只统计调用者当前学校的课程、
 * 未完成资料或未登录时什么都拿不到、一次最多 200 个 id。按真实顺序跑完全部 migration。
 */

const ALICE = "e1111111-1111-4111-8111-111111111111"; // wisc
const BOB = "e2222222-2222-4222-8222-222222222222"; // wisc
const CAROL = "e3333333-3333-4333-8333-333333333333"; // umich
const NEWBIE = "e4444444-4444-4444-8444-444444444444"; // wisc，没填资料

type Row = Record<string, unknown>;
type Attempt = { ok: true; rows: Row[] } | { ok: false; error: string };

let database: PGlite;
const courseIds: Record<string, string> = {};

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

async function counts(userId: string | null, codes: string[]) {
  const ids = codes.map((code) => `'${courseIds[code]}'`).join(", ");
  const result = await asUser(
    userId,
    `select course_id::text, member_count from public.get_course_member_counts(array[${ids}]::uuid[])`,
  );
  if (!result.ok) throw new Error(result.error);
  const byCode = Object.fromEntries(
    Object.entries(courseIds).map(([code, id]) => [id, code]),
  );
  return Object.fromEntries(
    result.rows.map((row) => [byCode[row.course_id as string], row.member_count]),
  );
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
      ('${NEWBIE}', 'newbie@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'), ('${BOB}', 'Bob'), ('${CAROL}', 'Carol');

    insert into public.courses (school_id, code, title, term) values
      ('uw-madison', 'CS 100', 'Intro', '2026-fall'),
      ('uw-madison', 'CS 200', 'Nobody yet', '2026-fall'),
      ('umich', 'EECS 280', 'Michigan', '2026-fall');
  `);
  const result = await database.query<{ id: string; code: string }>(
    "select id::text, code from public.courses",
  );
  for (const row of result.rows) courseIds[row.code] = row.id;

  for (const [user, code] of [
    [ALICE, "CS 100"],
    [BOB, "CS 100"],
    [CAROL, "EECS 280"],
  ] as const) {
    const joined = await asUser(
      user,
      `insert into public.course_members (course_id) values ('${courseIds[code]}')`,
    );
    if (!joined.ok) throw new Error(joined.error);
  }
});

afterAll(async () => {
  await database?.close();
});

describe("get_course_member_counts", () => {
  it("返回本校课程的成员数，还没人加入的课是 0", async () => {
    expect(await counts(BOB, ["CS 100", "CS 200"])).toEqual({ "CS 100": 2, "CS 200": 0 });
  });

  it("没加入的课也能看到人数，但看不到成员是谁", async () => {
    expect(await counts(CAROL, ["EECS 280"])).toEqual({ "EECS 280": 1 });
    const columns = await asUser(
      ALICE,
      `select * from public.get_course_member_counts(array['${courseIds["CS 200"]}']::uuid[])`,
    );
    expect(columns.ok && Object.keys(columns.rows[0])).toEqual(["course_id", "member_count"]);
  });

  it("其他学校的课程 id 不返回", async () => {
    expect(await counts(ALICE, ["EECS 280", "CS 100"])).toEqual({ "CS 100": 2 });
    expect(await counts(CAROL, ["CS 100"])).toEqual({});
  });

  it("未完成资料或没有登录身份时返回零行", async () => {
    expect(await counts(NEWBIE, ["CS 100"])).toEqual({});
    expect(await counts(null, ["CS 100"])).toEqual({});
  });

  it("一次最多统计 200 个课程 id", async () => {
    const padding = Array.from({ length: 200 }, () => `'${courseIds["CS 200"]}'`).join(", ");
    const result = await asUser(
      ALICE,
      `select course_id from public.get_course_member_counts(
         array[${padding}, '${courseIds["CS 100"]}']::uuid[])`,
    );
    expect(result.ok && result.rows.map((row) => row.course_id)).toEqual([courseIds["CS 200"]]);
  });

  it("只有已登录用户可以执行，未登录角色不行", async () => {
    await database.exec("set role anon;");
    const anon = await run(
      `select * from public.get_course_member_counts(array['${courseIds["CS 100"]}']::uuid[])`,
    );
    expect(anon.ok).toBe(false);
  });

  it("密歇根大学显示为安娜堡校区", async () => {
    const result = await run("select name_zh, name_en from public.schools where id = 'umich'");
    expect(result).toEqual({
      ok: true,
      rows: [{ name_zh: "密歇根大学安娜堡分校", name_en: "University of Michigan–Ann Arbor" }],
    });
  });
});
