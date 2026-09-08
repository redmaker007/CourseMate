import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 课程与群聊 migration 的越权测试。
 *
 * 四个 migration 一起跑：课程表建立在认证模块的 member_accounts / schools 之上，
 * 单独跑自己那两个证明不了它们能共存。
 *
 * 关键前提是复刻 Supabase 的 default privileges——真实环境里 anon/authenticated
 * 会自动拿到新建表的全部权限，不复刻这一条，所有测试都会因为"根本没权限"而假通过。
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";

let database: PGlite;
let courseId: string;
let groupId: string;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/** 以某个学生身份执行 SQL。被 RLS 或权限拦下时返回 ok:false。 */
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

/** 读取计数；被拦下时返回 -1，避免把"读不到"和"读到 0 条"混为一谈。 */
async function countAsUser(userId: string, sql: string): Promise<number> {
  const result = await asUser(userId, sql);
  if (!result.ok) return -1;
  return Number((result.rows[0] as { n: number }).n);
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

  for (const migrationName of [
    "202609050001_email_otp_request.sql",
    "202609050002_member_account_binding.sql",
    "202609070001_course_and_chat_schema.sql",
    "202609070002_course_and_chat_rls.sql",
  ]) {
    const migration = await readFile(
      resolve(process.cwd(), "supabase/migrations", migrationName),
      "utf8",
    );
    await database.exec(migration);
  }

  // 第二所学校用于跨校隔离测试。migration 只内置了 uw-madison。
  await database.exec(`
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('umich', '密歇根大学', 'University of Michigan', true);
    insert into public.school_email_domains (domain, school_id)
    values ('umich.edu', 'umich');

    insert into auth.users (id, email) values
      ('${ALICE}', 'alice@wisc.edu'),
      ('${BOB}',   'bob@wisc.edu'),
      ('${CAROL}', 'carol@umich.edu');
    update auth.users set email_confirmed_at = now();

    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'), ('${BOB}', 'Bob'), ('${CAROL}', 'Carol');
  `);

  const created = await asUser(
    ALICE,
    `insert into public.courses (school_id, code, title, term)
     values ('uw-madison', 'CS 540', 'Intro to AI', '2026-fall')
     returning id::text`,
  );
  if (!created.ok) throw new Error(`建课失败：${created.error}`);
  courseId = (created.rows[0] as { id: string }).id;

  const group = await database.query<{ id: string }>(
    `select id::text from public.groups where course_id = '${courseId}'`,
  );
  groupId = group.rows[0].id;

  await asUser(
    ALICE,
    `insert into public.course_members (course_id) values ('${courseId}')`,
  );
});

afterAll(async () => {
  await database.close();
});

describe("课程与认证模块共存", () => {
  it("邮箱确认后自动建立成员绑定，学校归属来自 member_accounts", async () => {
    const bindings = await database.query<{
      school_id: string;
      user_id: string;
    }>(
      `select user_id::text, school_id from public.member_accounts
       order by school_id, user_id`,
    );
    expect(bindings.rows).toEqual([
      { school_id: "umich", user_id: CAROL },
      { school_id: "uw-madison", user_id: ALICE },
      { school_id: "uw-madison", user_id: BOB },
    ]);
  });

  it("profiles 不再持有 school_id，避免出现第二个学校真相", async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain(
      "school_id",
    );
  });
});

describe("建课与自动建群", () => {
  it("建课时自动创建同名群", async () => {
    const group = await database.query<{ name: string }>(
      `select name from public.groups where course_id = '${courseId}'`,
    );
    expect(group.rows).toEqual([{ name: "CS 540 · 2026-fall" }]);
  });

  it("加课后自动进群", async () => {
    const count = await database.query<{ n: number }>(
      `select count(*)::int as n from public.group_members
       where group_id = '${groupId}' and user_id = '${ALICE}'`,
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("不能在外校名下建课", async () => {
    const result = await asUser(
      ALICE,
      `insert into public.courses (school_id, code, title, term)
       values ('umich', 'EECS 280', 'Programming', '2026-fall') returning id`,
    );
    expect(result.ok).toBe(false);
  });
});

describe("冒充他人", () => {
  it("不能替别人加课", async () => {
    const result = await asUser(
      ALICE,
      `insert into public.course_members (course_id, user_id)
       values ('${courseId}', '${BOB}')`,
    );
    expect(result.ok).toBe(false);
  });

  it("不能手动拉人进群", async () => {
    const result = await asUser(
      ALICE,
      `insert into public.group_members (group_id, user_id)
       values ('${groupId}', '${BOB}')`,
    );
    expect(result.ok).toBe(false);
  });

  it("不能修改他人资料", async () => {
    const result = await asUser(
      ALICE,
      `update public.profiles set display_name = 'Hacked'
       where id = '${BOB}' returning id`,
    );
    expect(result.ok && result.rows.length > 0).toBe(false);
  });
});

describe("群聊消息", () => {
  it("群成员可以发消息", async () => {
    const result = await asUser(
      ALICE,
      `insert into public.messages (group_id, body)
       values ('${groupId}', 'hello') returning id`,
    );
    expect(result.ok).toBe(true);
  });

  it("非群成员不能发消息", async () => {
    const result = await asUser(
      BOB,
      `insert into public.messages (group_id, body) values ('${groupId}', 'hi')`,
    );
    expect(result.ok).toBe(false);
  });

  it("非群成员读不到消息", async () => {
    expect(
      await countAsUser(
        BOB,
        `select count(*)::int as n from public.messages
         where group_id = '${groupId}'`,
      ),
    ).toBe(0);
  });

  it("消息不可修改，避免被挪进别的群", async () => {
    const result = await asUser(
      ALICE,
      `update public.messages set body = 'changed'
       where group_id = '${groupId}'`,
    );
    expect(result.ok).toBe(false);
  });

  it("消息不可删除", async () => {
    const result = await asUser(
      ALICE,
      `delete from public.messages where group_id = '${groupId}'`,
    );
    expect(result.ok).toBe(false);
  });
});

describe("可见性隔离", () => {
  it("同校但无共同课程时看不到对方资料", async () => {
    expect(
      await countAsUser(
        ALICE,
        `select count(*)::int as n from public.profiles where id = '${BOB}'`,
      ),
    ).toBe(0);
  });

  it("跨校看不到对方资料", async () => {
    expect(
      await countAsUser(
        ALICE,
        `select count(*)::int as n from public.profiles where id = '${CAROL}'`,
      ),
    ).toBe(0);
  });

  it("跨校搜不到对方课程", async () => {
    await database.exec(
      `insert into public.courses (school_id, code, title, term, created_by)
       values ('umich', 'EECS 280', 'Programming', '2026-fall', '${CAROL}');`,
    );
    expect(
      await countAsUser(
        ALICE,
        `select count(*)::int as n from public.courses
         where school_id = 'umich'`,
      ),
    ).toBe(0);
  });

  it("加入同一门课之后才能看到同学资料", async () => {
    await asUser(
      BOB,
      `insert into public.course_members (course_id) values ('${courseId}')`,
    );
    expect(
      await countAsUser(
        ALICE,
        `select count(*)::int as n from public.profiles where id = '${BOB}'`,
      ),
    ).toBe(1);
  });
});

describe("未登录访客", () => {
  it("读不到任何业务数据，但仍能读开放学校列表", async () => {
    await database.exec("set role anon;");
    const readable: Record<string, number | string> = {};
    for (const [key, sql] of [
      ["profiles", "select count(*)::int as n from public.profiles"],
      ["courses", "select count(*)::int as n from public.courses"],
      ["messages", "select count(*)::int as n from public.messages"],
      ["schools", "select count(*)::int as n from public.schools"],
    ] as const) {
      try {
        const result = await database.query<{ n: number }>(sql);
        readable[key] = result.rows[0].n;
      } catch {
        readable[key] = "denied";
      }
    }
    await database.exec("reset role;");

    expect(readable.profiles).toBe("denied");
    expect(readable.courses).toBe("denied");
    expect(readable.messages).toBe("denied");
    expect(readable.schools).toBe(2);
  });
});

describe("退课", () => {
  it("退课后自动退群", async () => {
    await asUser(
      ALICE,
      `delete from public.course_members where course_id = '${courseId}'`,
    );
    const count = await database.query<{ n: number }>(
      `select count(*)::int as n from public.group_members
       where group_id = '${groupId}' and user_id = '${ALICE}'`,
    );
    expect(count.rows[0].n).toBe(0);
  });
});
