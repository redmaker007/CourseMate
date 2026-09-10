import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const NO_PROFILE = "11111111-1111-4111-8111-111111111111";
const VALID_PROFILE = "22222222-2222-4222-8222-222222222222";
const LEGACY_PROFILE = "33333333-3333-4333-8333-333333333333";

let database: PGlite;
let courseId: string;

const BASE_MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
] as const;
const PROFILE_MIGRATION = "202609090002_profile_onboarding.sql";
const PROFILE_PREFLIGHT = "202609090002_profile_onboarding.sql";

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

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

async function onboardingStatus(userId: string) {
  const result = await asUser(
    userId,
    "select public.has_completed_onboarding() as completed",
  );
  if (!result.ok) throw new Error(result.error);
  return result.rows[0].completed;
}

async function createSchemaDatabase() {
  const testDatabase = new PGlite();

  await testDatabase.exec(`
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
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
  `);

  for (const migrationName of BASE_MIGRATIONS) {
    const migration = await readFile(
      resolve(process.cwd(), "supabase/migrations", migrationName),
      "utf8",
    );
    await testDatabase.exec(migration);
  }

  return testDatabase;
}

async function applyProfileMigration(testDatabase: PGlite) {
  const migration = await readFile(
    resolve(process.cwd(), "supabase/migrations", PROFILE_MIGRATION),
    "utf8",
  );
  await testDatabase.exec(migration);
}

async function runProfilePreflight(testDatabase: PGlite) {
  const preflight = await readFile(
    resolve(process.cwd(), "supabase/preflight", PROFILE_PREFLIGHT),
    "utf8",
  );
  await testDatabase.exec(preflight);
}

beforeAll(async () => {
  database = await createSchemaDatabase();

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${NO_PROFILE}', 'no-profile@wisc.edu', now()),
      ('${VALID_PROFILE}', 'valid-profile@wisc.edu', now()),
      ('${LEGACY_PROFILE}', 'legacy-profile@wisc.edu', now());

    insert into public.profiles (id, display_name) values
      ('${VALID_PROFILE}', '一二三四五六七八九十一二三四五'),
      ('${LEGACY_PROFILE}', '一二三四五六七八九十一二三四五六');

    insert into public.courses (school_id, code, title, term, created_by)
    values ('uw-madison', 'TEST 11', 'Profile onboarding test', '2026-fall', '${VALID_PROFILE}');
  `);

  const course = await database.query<{ id: string }>(
    "select id::text from public.courses where code = 'TEST 11'",
  );
  courseId = course.rows[0].id;

  await runProfilePreflight(database);
  await applyProfileMigration(database);
});

afterAll(async () => {
  await database.close();
});

describe("Profile onboarding migration", () => {
  it("迁移前预检能识别需要用户修正的旧资料", async () => {
    const audit = await database.query<{ invalid_profile_count: number }>(
      `select count(*)::int as invalid_profile_count
       from public.profiles
       where char_length(trim(display_name)) not between 1 and 15`,
    );
    expect(audit.rows).toEqual([{ invalid_profile_count: 1 }]);
  });

  it("Profile 表为空时完整 migration 链可以一次应用", async () => {
    const emptyDatabase = await createSchemaDatabase();
    try {
      await expect(applyProfileMigration(emptyDatabase)).resolves.toBeUndefined();
      const profiles = await emptyDatabase.query<{ count: number }>(
        "select count(*)::int as count from public.profiles",
      );
      expect(profiles.rows).toEqual([{ count: 0 }]);
    } finally {
      await emptyDatabase.close();
    }
  });

  it("只有符合当前显示名称规则的 Profile 才完成 onboarding", async () => {
    await expect(onboardingStatus(NO_PROFILE)).resolves.toBe(false);
    await expect(onboardingStatus(VALID_PROFILE)).resolves.toBe(true);
    await expect(onboardingStatus(LEGACY_PROFILE)).resolves.toBe(false);
  });

  it("保留旧的超长显示名称，但禁止继续使用主应用", async () => {
    const legacy = await database.query<{ display_name: string }>(
      `select display_name from public.profiles where id = '${LEGACY_PROFILE}'`,
    );

    expect(legacy.rows).toEqual([
      { display_name: "一二三四五六七八九十一二三四五六" },
    ]);
    await expect(onboardingStatus(LEGACY_PROFILE)).resolves.toBe(false);
  });

  it("数据库接受 15 个中文字符并拒绝 16 个", async () => {
    const accepted = await asUser(
      NO_PROFILE,
      `insert into public.profiles (id, display_name)
       values ('${NO_PROFILE}', '一二三四五六七八九十一二三四五')`,
    );
    expect(accepted.ok).toBe(true);

    const rejected = await asUser(
      NO_PROFILE,
      `update public.profiles
       set display_name = '一二三四五六七八九十一二三四五六'
       where id = '${NO_PROFILE}'`,
    );
    expect(rejected.ok).toBe(false);
  });

  it("未完成 onboarding 的认证客户端不能直接写现有业务表", async () => {
    const hiddenCourses = await asUser(
      LEGACY_PROFILE,
      "select id from public.courses",
    );
    expect(hiddenCourses.ok && hiddenCourses.rows).toEqual([]);

    const missing = await asUser(
      LEGACY_PROFILE,
      `insert into public.course_members (course_id)
       values ('${courseId}')`,
    );
    expect(missing.ok).toBe(false);

    const completed = await asUser(
      VALID_PROFILE,
      `insert into public.course_members (course_id)
       values ('${courseId}')`,
    );
    expect(completed.ok).toBe(true);
  });

  it("成员不能修改其他人的 Profile", async () => {
    const result = await asUser(
      VALID_PROFILE,
      `update public.profiles
       set display_name = '越权修改'
       where id = '${LEGACY_PROFILE}'
       returning id`,
    );
    expect(result.ok && result.rows.length > 0).toBe(false);
  });

  it("旧超长资料修正后立即完成 onboarding", async () => {
    const corrected = await asUser(
      LEGACY_PROFILE,
      `update public.profiles
       set display_name = '修正后的名字'
       where id = '${LEGACY_PROFILE}'`,
    );
    expect(corrected.ok).toBe(true);
    await expect(onboardingStatus(LEGACY_PROFILE)).resolves.toBe(true);
  });
});
