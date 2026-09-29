import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MEMBER = "c5000000-0000-4000-8000-000000000001";
const INCOMPLETE = "c5000000-0000-4000-8000-000000000002";

let database: PGlite;

async function consume(userId = MEMBER) {
  await database.exec(
    "set role service_role;",
  );
  try {
    return (
      await database.query<{
        result_status: string;
        retry_after_seconds: number;
      }>(
        `select result_status, retry_after_seconds
         from public.consume_course_recognition_quota('${userId}'::uuid)`,
      )
    ).rows;
  } finally {
    await database.exec("reset role;");
  }
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
      ('${MEMBER}', 'quota@wisc.edu', now()),
      ('${INCOMPLETE}', 'incomplete-quota@wisc.edu', now());
    insert into public.profiles (id, display_name)
    values ('${MEMBER}', 'Quota');
  `);
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.exec("delete from public.course_recognition_attempts;");
});

describe("consume_course_recognition_quota", () => {
  it("允许十分钟内前五次识别，并拒绝第六次", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await consume()).toEqual([
        { result_status: "allowed", retry_after_seconds: 0 },
      ]);
    }

    const [limited] = await consume();
    expect(limited).toMatchObject({ result_status: "personal_limit" });
    expect(Number(limited.retry_after_seconds)).toBeGreaterThan(0);
  });

  it("旧于十分钟的记录不占个人额度", async () => {
    await database.exec(`
      insert into public.course_recognition_attempts (actor_id, attempted_at)
      select '${MEMBER}', now() - interval '11 minutes'
      from generate_series(1, 5);
    `);

    expect(await consume()).toEqual([
      { result_status: "allowed", retry_after_seconds: 0 },
    ]);
  });

  it("全站本月达到七千次后不再消费额度", async () => {
    await database.exec(`
      insert into public.course_recognition_attempts (actor_id, attempted_at)
      select '${MEMBER}', now()
      from generate_series(1, 7000);
    `);

    const [limited] = await consume();
    expect(limited).toMatchObject({ result_status: "global_limit" });
    expect(Number(limited.retry_after_seconds)).toBeGreaterThan(0);
  });

  it("未完成 onboarding 的成员不能消费额度", async () => {
    expect(await consume(INCOMPLETE)).toEqual([
      { result_status: "onboarding_required", retry_after_seconds: 0 },
    ]);
    const [count] = (
      await database.query<{ count: number }>(
        "select count(*)::integer as count from public.course_recognition_attempts",
      )
    ).rows;
    expect(count).toEqual({ count: 0 });
  });

  it("只开放函数给 authenticated，额度表不开放给客户端角色", async () => {
    const [privileges] = (
      await database.query(`
        select
          has_function_privilege('anon', 'public.consume_course_recognition_quota(uuid)', 'execute') as anon_execute,
          has_function_privilege('authenticated', 'public.consume_course_recognition_quota(uuid)', 'execute') as authenticated_execute,
          has_function_privilege('service_role', 'public.consume_course_recognition_quota(uuid)', 'execute') as service_execute,
          has_table_privilege('anon', 'public.course_recognition_attempts', 'select') as anon_select,
          has_table_privilege('authenticated', 'public.course_recognition_attempts', 'select') as authenticated_select
      `)
    ).rows;

    expect(privileges).toEqual({
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
      anon_select: false,
      authenticated_select: false,
    });
  });

  it("保留并发额度所需的事务级全站锁", async () => {
    const [definition] = (
      await database.query<{ definition: string }>(`
        select pg_get_functiondef(
          'public.consume_course_recognition_quota(uuid)'::regprocedure
        ) as definition
      `)
    ).rows;

    // PGlite 只有单连接；这里锁定并发不变量的实现护栏，真实 PostgreSQL 部署前再做双连接验收。
    const sql = definition.definition.toLowerCase();
    const lock = sql.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(sql.indexOf("into monthly_count"));
    expect(lock).toBeLessThan(
      sql.indexOf("insert into public.course_recognition_attempts"),
    );
  });
});
