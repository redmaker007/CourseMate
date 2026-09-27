import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const INCOMPLETE = "44444444-4444-4444-8444-444444444444";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = Record<string, unknown>;
type Attempt = { ok: true; rows: Row[] } | { ok: false; error: string };

let database: PGlite;

async function asUser(userId: string, sql: string): Promise<Attempt> {
  await database.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', false);
  `);
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Row[] };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  } finally {
    await database.exec("reset role;");
  }
}

async function rowsAsUser(userId: string, sql: string): Promise<Row[]> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
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
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('umich', '密歇根大学', 'University of Michigan', true)
    on conflict (id) do nothing;
    insert into public.school_email_domains (domain, school_id)
    values ('umich.edu', 'umich')
    on conflict (domain) do nothing;

    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CAROL}', 'carol@umich.edu', now()),
      ('${INCOMPLETE}', 'incomplete@wisc.edu', now());
    insert into public.profiles (id, display_name, major, grad_year) values
      ('${ALICE}', 'Alice', 'Computer Science', 2027),
      ('${BOB}', 'Bob', 'Mathematics', 2028),
      ('${CAROL}', 'Carol', 'Physics', 2027);

    insert into public.courses (school_id, code, title, term, created_by) values
      ('uw-madison', 'TEST 101', 'Wisconsin Course', '2026-fall', '${ALICE}'),
      ('umich', 'TEST 202', 'Michigan Course', '2026-fall', '${CAROL}');
    insert into public.course_members (course_id, user_id)
    select id, member_id
    from public.courses
    cross join (values ('${ALICE}'::uuid), ('${BOB}'::uuid)) members(member_id)
    where school_id = 'uw-madison';

    insert into public.friend_requests (
      id, requester_id, recipient_id, pair_low, pair_high, message, expires_at
    ) values (
      '${REQUEST}', '${ALICE}', '${BOB}', '${ALICE}', '${BOB}', 'hello',
      now() + interval '3 days'
    );
    insert into public.member_blocks (blocker_id, blocked_id)
    values ('${ALICE}', '${BOB}');
    insert into public.behavior_reports (
      reporter_id, target_type, target_id, reason
    ) values
      ('${ALICE}', 'profile', '${BOB}', 'spam'),
      ('${BOB}', 'profile', '${ALICE}', 'spam');
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("RLS InitPlan 优化", () => {
  it("14 条策略只把查询级固定值改成 InitPlan，逐行函数保持原样", async () => {
    const expectedCalls: Record<
      string,
      readonly [number, number, number]
    > = {
      behavior_reports_select_own: [1, 1, 0],
      course_catalog_select_own_school: [1, 0, 1],
      course_members_select: [1, 1, 0],
      course_members_insert_self: [1, 1, 1],
      course_members_delete_self: [1, 1, 1],
      courses_select_own_school: [1, 0, 1],
      friend_preferences_select_owner: [1, 1, 0],
      friend_requests_select_participant: [1, 2, 0],
      friendships_select_participant: [1, 2, 0],
      member_blocks_select_owner: [1, 1, 0],
      profiles_insert_self: [0, 1, 0],
      profiles_select_self_or_classmate: [1, 1, 0],
      profiles_update_self: [0, 2, 0],
      school_term_settings_select_own_school: [1, 0, 1],
    };

    const policies = await database.query<{
      policyname: string;
      expression: string;
    }>(`
      select
        policyname,
        coalesce(qual, '') || ' ' || coalesce(with_check, '') as expression
      from pg_policies
      where schemaname = 'public'
        and policyname in (${Object.keys(expectedCalls)
          .map((name) => `'${name}'`)
          .join(", ")})
      order by policyname
    `);

    expect(policies.rows).toHaveLength(14);
    for (const policy of policies.rows) {
      const expected = expectedCalls[policy.policyname];
      const expression = policy.expression;
      const functions = [
        /(?:public\.)?has_completed_onboarding\(\)/gi,
        /auth\.uid\(\)/gi,
        /(?:public\.)?current_school_id\(\)/gi,
      ];
      const wrappedFunctions = [
        /select\s+(?:public\.)?has_completed_onboarding\(\)/gi,
        /select\s+auth\.uid\(\)/gi,
        /select\s+(?:public\.)?current_school_id\(\)/gi,
      ];

      expected.forEach((count, index) => {
        expect(countMatches(expression, functions[index])).toBe(count);
        expect(countMatches(expression, wrappedFunctions[index])).toBe(count);
      });
    }

    const courseMembers = policies.rows.find(
      ({ policyname }) => policyname === "course_members_select",
    )?.expression ?? "";
    const profiles = policies.rows.find(
      ({ policyname }) => policyname === "profiles_select_self_or_classmate",
    )?.expression ?? "";
    expect(courseMembers).toMatch(/is_course_member\(course_id\)/i);
    expect(courseMembers).not.toMatch(/select\s+(?:public\.)?is_course_member/i);
    expect(profiles).toMatch(/shares_course_with\(id\)/i);
    expect(profiles).not.toMatch(/select\s+(?:public\.)?shares_course_with/i);
  });

  it("优化后仍按学校、onboarding 和数据所有者隔离权限", async () => {
    expect(
      await rowsAsUser(
        ALICE,
        "select school_id from public.courses order by school_id",
      ),
    ).toEqual([{ school_id: "uw-madison" }]);
    expect(
      await rowsAsUser(INCOMPLETE, "select school_id from public.courses"),
    ).toEqual([]);

    expect(
      await rowsAsUser(ALICE, "select id::text from public.friend_requests"),
    ).toEqual([{ id: REQUEST }]);
    expect(
      await rowsAsUser(BOB, "select id::text from public.friend_requests"),
    ).toEqual([{ id: REQUEST }]);
    expect(
      await rowsAsUser(CAROL, "select id::text from public.friend_requests"),
    ).toEqual([]);

    expect(
      await rowsAsUser(
        ALICE,
        "select blocker_id::text, blocked_id::text from public.member_blocks",
      ),
    ).toEqual([{ blocker_id: ALICE, blocked_id: BOB }]);
    expect(
      await rowsAsUser(BOB, "select blocked_id::text from public.member_blocks"),
    ).toEqual([]);

    expect(
      await rowsAsUser(
        ALICE,
        "select reporter_id::text from public.behavior_reports order by reporter_id",
      ),
    ).toEqual([{ reporter_id: ALICE }]);
    expect(
      await rowsAsUser(
        BOB,
        "select reporter_id::text from public.behavior_reports order by reporter_id",
      ),
    ).toEqual([{ reporter_id: BOB }]);

    expect(
      await rowsAsUser(
        ALICE,
        "select id::text from public.profiles order by id",
      ),
    ).toEqual([{ id: ALICE }, { id: BOB }]);
    expect(
      await rowsAsUser(
        ALICE,
        "update public.profiles set display_name = 'Alice Updated' where id = auth.uid() returning id::text",
      ),
    ).toEqual([{ id: ALICE }]);
    expect(
      await rowsAsUser(
        ALICE,
        `update public.profiles set display_name = 'Not Allowed' where id = '${BOB}' returning id::text`,
      ),
    ).toEqual([]);
  });
});

describe("外键索引", () => {
  it("13 个索引都存在且列顺序与外键一致", async () => {
    const expectedIndexes: Record<string, string> = {
      admin_audit_log_actor_id_idx: "public.admin_audit_log using btree (actor_id)",
      admin_school_test_context_school_id_idx:
        "public.admin_school_test_context using btree (school_id)",
      courses_created_by_idx: "public.courses using btree (created_by)",
      direct_conversations_member_high_idx:
        "public.direct_conversations using btree (member_high)",
      direct_message_cleanup_eligibility_message_idx:
        "public.direct_message_cleanup_eligibility using btree (conversation_id, message_id)",
      friend_preferences_owner_id_idx:
        "public.friend_preferences using btree (owner_id)",
      friend_rate_limit_buckets_action_kind_idx:
        "public.friend_rate_limit_buckets using btree (action_kind)",
      friend_requests_recipient_id_idx:
        "public.friend_requests using btree (recipient_id)",
      friend_requests_requester_id_idx:
        "public.friend_requests using btree (requester_id)",
      friendships_pair_high_idx: "public.friendships using btree (pair_high)",
      member_accounts_school_id_idx:
        "public.member_accounts using btree (school_id)",
      member_blocks_blocked_id_idx:
        "public.member_blocks using btree (blocked_id)",
      platform_roles_granted_by_idx:
        "public.platform_roles using btree (granted_by)",
    };
    const indexes = await database.query<{ indexname: string; indexdef: string }>(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (${Object.keys(expectedIndexes)
          .map((name) => `'${name}'`)
          .join(", ")})
      order by indexname
    `);

    expect(indexes.rows).toHaveLength(13);
    for (const index of indexes.rows) {
      expect(index.indexdef.toLowerCase()).toContain(
        expectedIndexes[index.indexname].toLowerCase(),
      );
    }
  });
});
