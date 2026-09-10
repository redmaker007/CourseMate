import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090001_profile_onboarding.sql",
  "202609100001_unified_conversation_core.sql",
] as const;

let database: PGlite;

async function readSql(directory: "migrations" | "seeds", name: string) {
  return readFile(resolve(process.cwd(), "supabase", directory, name), "utf8");
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
  for (const migration of MIGRATIONS) {
    await database.exec(await readSql("migrations", migration));
  }
  await database.exec(
    await readSql("migrations", "202609100002_course_flow.sql"),
  );
});

afterAll(async () => {
  await database?.close();
});

describe("Issue #13 TEST00 manual fixture", () => {
  it("is repeatable and creates exactly one course conversation per school", async () => {
    const seed = await readSql("seeds", "issue-13-test00.sql");
    await database.exec(seed);
    await database.exec(seed);

    const rows = await database.query<{
      id: string;
      school_id: string;
      code: string;
      title: string;
      term: string;
    }>(`
      select id::text, school_id, code, title, term
      from public.courses
      where id in (
        '13000000-0000-4000-8000-000000000001',
        '13000000-0000-4000-8000-000000000002'
      )
      order by school_id
    `);
    expect(rows.rows).toEqual([
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

    const links = await database.query<{ count: number }>(`
      select count(*)::int
      from public.course_conversations
      where course_id in (
        '13000000-0000-4000-8000-000000000001',
        '13000000-0000-4000-8000-000000000002'
      )
    `);
    expect(links.rows).toEqual([{ count: 2 }]);
  });

  it("cleanup removes only the exact fixtures and their owned conversations", async () => {
    const conversationIds = await database.query<{ conversation_id: string }>(`
      select conversation_id::text
      from public.course_conversations
      where course_id in (
        '13000000-0000-4000-8000-000000000001',
        '13000000-0000-4000-8000-000000000002'
      )
    `);
    await database.exec(`
      insert into public.courses (school_id, code, title, term)
      values ('uw-madison', 'TEST01', 'Keep me', '2026-fall');
    `);
    await database.exec(
      await readSql("seeds", "issue-13-test00-cleanup.sql"),
    );

    const remainingFixtures = await database.query<{ count: number }>(`
      select count(*)::int from public.courses
      where id in (
        '13000000-0000-4000-8000-000000000001',
        '13000000-0000-4000-8000-000000000002'
      )
    `);
    expect(remainingFixtures.rows).toEqual([{ count: 0 }]);

    const orphaned = await database.query<{ count: number }>(`
      select count(*)::int from public.conversations
      where id in (${conversationIds.rows.map((row) => `'${row.conversation_id}'`).join(",")})
    `);
    expect(orphaned.rows).toEqual([{ count: 0 }]);

    const control = await database.query<{ count: number }>(`
      select count(*)::int from public.courses where code = 'TEST01'
    `);
    expect(control.rows).toEqual([{ count: 1 }]);
  });
});
