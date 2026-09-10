import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CHARLIE = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";

const MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090001_profile_onboarding.sql",
] as const;

let database: PGlite;
let courseId: string;
let legacyConversationId: string;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

async function asRole(role: "anon" | "authenticated", sql: string, userId?: string) {
  await database.exec(`set role ${role};`);
  if (userId) {
    await database.exec(
      `select set_config('request.jwt.claim.sub', '${userId}', false);`,
    );
  }
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] } as Attempt;
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message.split("\n")[0],
    } as Attempt;
  } finally {
    await database.exec("reset role;");
  }
}

async function readMigration(name: string) {
  return readFile(
    resolve(process.cwd(), "supabase/migrations", name),
    "utf8",
  );
}

async function applyMigration(target: PGlite, name: string) {
  await target.exec(await readMigration(name));
}

async function createBaseDatabase() {
  const target = new PGlite();
  await target.exec(`
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
  for (const migration of MIGRATIONS) await applyMigration(target, migration);
  return target;
}

async function createDirectConversation(memberLow: string, memberHigh: string) {
  const conversation = await database.query<{ id: string }>(
    `insert into public.conversations (kind) values ('direct') returning id::text`,
  );
  const conversationId = conversation.rows[0].id;
  await database.exec(
    `insert into public.direct_conversations
       (conversation_id, member_low, member_high)
     values ('${conversationId}', '${memberLow}', '${memberHigh}')`,
  );
  return conversationId;
}

beforeAll(async () => {
  database = await createBaseDatabase();

  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@wisc.edu', now()),
      ('${BOB}', 'bob@wisc.edu', now()),
      ('${CHARLIE}', 'charlie@wisc.edu', now()),
      ('${DAVE}', 'dave@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'),
      ('${BOB}', 'Bob'),
      ('${DAVE}', 'Dave');
    insert into public.courses (school_id, code, title, term, created_by)
    values ('uw-madison', 'CS 540', 'Intro to AI', '2026-fall', '${ALICE}');
  `);

  const course = await database.query<{ id: string }>(
    "select id::text from public.courses where code = 'CS 540'",
  );
  courseId = course.rows[0].id;
  const group = await database.query<{ id: string }>(
    `select id::text from public.groups where course_id = '${courseId}'`,
  );
  legacyConversationId = group.rows[0].id;

  await database.exec(`
    insert into public.course_members (course_id, user_id, joined_at) values
      ('${courseId}', '${ALICE}', '2026-09-01T01:00:00Z'),
      ('${courseId}', '${BOB}', '2026-09-01T02:00:00Z'),
      ('${courseId}', '${CHARLIE}', '2026-09-01T03:00:00Z');
    update public.group_members
    set joined_at = case user_id
      when '${ALICE}' then '2026-09-01T01:00:00Z'::timestamptz
      when '${BOB}' then '2026-09-01T02:00:00Z'::timestamptz
      else '2026-09-01T03:00:00Z'::timestamptz
    end
    where group_id = '${legacyConversationId}';
    insert into public.messages
      (id, group_id, sender_id, body, created_at, deleted_at)
      overriding system value
    values
      (41, '${legacyConversationId}', '${ALICE}', 'first', '2026-09-02T01:00:00Z', null),
      (42, '${legacyConversationId}', '${BOB}', 'deleted', '2026-09-02T02:00:00Z', '2026-09-03T00:00:00Z');
  `);

  await applyMigration(database, "202609100001_unified_conversation_core.sql");
});

afterAll(async () => {
  await database?.close();
});

describe("统一会话历史数据迁移", () => {
  it("迁移断言失败时回滚并保留全部旧结构", async () => {
    const failedDatabase = await createBaseDatabase();
    try {
      await failedDatabase.exec(`
        insert into auth.users (id, email, email_confirmed_at)
        values ('${ALICE}', 'rollback@wisc.edu', now());
        insert into public.profiles (id, display_name)
        values ('${ALICE}', 'Rollback');
        insert into public.courses (school_id, code, title, term, created_by)
        values ('uw-madison', 'TEST 12', 'Rollback test', '2026-fall', '${ALICE}');
        insert into public.course_members (course_id, user_id)
        select id, '${ALICE}' from public.courses where code = 'TEST 12';
      `);

      const migration = await readMigration(
        "202609100001_unified_conversation_core.sql",
      );
      const faultedMigration = migration.replace(
        "-- Abort the transaction before removing the old source tables",
        "delete from public.conversation_members;\n\n-- Abort the transaction before removing the old source tables",
      );
      expect(faultedMigration).not.toBe(migration);

      let migrationError: Error | null = null;
      try {
        await failedDatabase.exec(faultedMigration);
      } catch (error) {
        migrationError = error as Error;
      }
      await failedDatabase.exec("rollback");
      expect(migrationError?.message).toContain("membership mismatch");

      const oldState = await failedDatabase.query(
        `select
          to_regclass('public.groups')::text as groups_table,
          to_regclass('public.group_members')::text as members_table,
          (select count(*)::int from public.groups) as group_count,
          (select count(*)::int from public.group_members) as member_count,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'messages'
              and column_name = 'group_id'
          ) as messages_still_use_group_id`,
      );
      expect(oldState.rows).toEqual([
        {
          groups_table: "groups",
          members_table: "group_members",
          group_count: 1,
          member_count: 1,
          messages_still_use_group_id: true,
        },
      ]);
    } finally {
      await failedDatabase.close();
    }
  });

  it("完整保留课程会话、成员和消息身份", async () => {
    const conversation = await database.query(
      `select c.id::text, c.kind, cc.course_id::text
       from public.conversations c
       join public.course_conversations cc on cc.conversation_id = c.id`,
    );
    expect(conversation.rows).toEqual([
      { id: legacyConversationId, kind: "course", course_id: courseId },
    ]);

    const members = await database.query(
      `select user_id::text,
              to_char(joined_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as joined_at
       from public.conversation_members
       where conversation_id = '${legacyConversationId}'
       order by joined_at`,
    );
    expect(members.rows).toEqual([
      { user_id: ALICE, joined_at: "2026-09-01 01:00:00" },
      { user_id: BOB, joined_at: "2026-09-01 02:00:00" },
      { user_id: CHARLIE, joined_at: "2026-09-01 03:00:00" },
    ]);

    const messages = await database.query(
      `select id::int, conversation_id::text, sender_id::text, body,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as created_at,
              to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as deleted_at
       from public.messages order by id`,
    );
    expect(messages.rows).toEqual([
      {
        id: 41,
        conversation_id: legacyConversationId,
        sender_id: ALICE,
        body: "first",
        created_at: "2026-09-02 01:00:00",
        deleted_at: null,
      },
      {
        id: 42,
        conversation_id: legacyConversationId,
        sender_id: BOB,
        body: "deleted",
        created_at: "2026-09-02 02:00:00",
        deleted_at: "2026-09-03 00:00:00",
      },
    ]);
  });

  it("消息 Realtime 注册保持唯一并建立游标分页索引", async () => {
    const publication = await database.query<{ n: number }>(
      `select count(*)::int as n
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'`,
    );
    expect(publication.rows).toEqual([{ n: 1 }]);

    const cursorIndex = await database.query<{ n: number }>(
      `select count(*)::int as n
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'messages'
         and indexdef like '%(conversation_id, id DESC)%'`,
    );
    expect(cursorIndex.rows).toEqual([{ n: 1 }]);
  });

  it("课程关系不能指向非课程类型的会话", async () => {
    const wrongKind = await database.query<{ id: string }>(
      `insert into public.conversations (kind) values ('direct') returning id::text`,
    );
    await database.exec("begin");
    let rejected = false;
    try {
      await database.exec(
        `update public.course_conversations
         set conversation_id = '${wrongKind.rows[0].id}'
         where course_id = '${courseId}'`,
      );
    } catch {
      rejected = true;
    } finally {
      await database.exec("rollback");
      await database.exec(
        `delete from public.conversations where id = '${wrongKind.rows[0].id}'`,
      );
    }
    expect(rejected).toBe(true);

    await database.exec("begin");
    let kindChangeRejected = false;
    try {
      await database.exec(
        `update public.conversations set kind = 'direct'
         where id = '${legacyConversationId}'`,
      );
    } catch {
      kindChangeRejected = true;
    } finally {
      await database.exec("rollback");
    }
    expect(kindChangeRejected).toBe(true);
  });
});

describe("统一会话 RLS", () => {
  it("匿名用户无法读取会话核心数据", async () => {
    for (const table of [
      "conversations",
      "course_conversations",
      "direct_conversations",
      "conversation_members",
      "messages",
    ]) {
      const result = await asRole("anon", `select * from public.${table}`);
      expect(result.ok, `${table} should reject anon`).toBe(false);
    }
  });

  it("只有完成 onboarding 的课程成员能读取课程会话", async () => {
    const member = await asRole(
      "authenticated",
      `select id from public.conversations where id = '${legacyConversationId}'`,
      ALICE,
    );
    expect(member.ok && member.rows.length).toBe(1);

    const incompleteMember = await asRole(
      "authenticated",
      `select id from public.conversations where id = '${legacyConversationId}'`,
      CHARLIE,
    );
    expect(incompleteMember.ok && incompleteMember.rows.length).toBe(0);

    const nonMember = await asRole(
      "authenticated",
      `select id from public.conversations where id = '${legacyConversationId}'`,
      DAVE,
    );
    expect(nonMember.ok && nonMember.rows.length).toBe(0);
  });

  it("未完成 onboarding 的成员和非课程成员不能读取或发送消息", async () => {
    for (const userId of [CHARLIE, DAVE]) {
      const read = await asRole(
        "authenticated",
        `select id from public.messages
         where conversation_id = '${legacyConversationId}'`,
        userId,
      );
      expect(read.ok && read.rows).toEqual([]);

      const send = await asRole(
        "authenticated",
        `insert into public.messages (conversation_id, body)
         values ('${legacyConversationId}', 'not allowed')`,
        userId,
      );
      expect(send.ok).toBe(false);
    }
  });

  it("课程成员可读写活跃会话，归档后保留历史和成员列表但拒绝新消息", async () => {
    const visibleBeforeArchive = await asRole(
      "authenticated",
      `select id from public.messages
       where conversation_id = '${legacyConversationId}' order by id`,
      ALICE,
    );
    expect(visibleBeforeArchive.ok && visibleBeforeArchive.rows).toEqual([
      { id: 41 },
    ]);

    const sent = await asRole(
      "authenticated",
      `insert into public.messages (conversation_id, body)
       values ('${legacyConversationId}', 'before archive') returning id`,
      ALICE,
    );
    expect(sent.ok).toBe(true);
    expect(Number((sent as { ok: true; rows: { id: number }[] }).rows[0].id)).toBeGreaterThan(
      42,
    );

    await database.exec(
      `update public.conversations set archived_at = now()
       where id = '${legacyConversationId}'`,
    );

    const blocked = await asRole(
      "authenticated",
      `insert into public.messages (conversation_id, body)
       values ('${legacyConversationId}', 'after archive')`,
      ALICE,
    );
    expect(blocked.ok).toBe(false);

    const history = await asRole(
      "authenticated",
      `select count(*)::int as n from public.messages
       where conversation_id = '${legacyConversationId}'`,
      ALICE,
    );
    expect(history.ok && history.rows).toEqual([{ n: 2 }]);

    const members = await asRole(
      "authenticated",
      `select count(*)::int as n from public.conversation_members
       where conversation_id = '${legacyConversationId}'`,
      ALICE,
    );
    expect(members.ok && members.rows).toEqual([{ n: 3 }]);
  });

  it("客户端不能更新或删除消息", async () => {
    const updated = await asRole(
      "authenticated",
      `update public.messages set body = 'changed' where id = 41`,
      ALICE,
    );
    const deleted = await asRole(
      "authenticated",
      `delete from public.messages where id = 41`,
      ALICE,
    );
    expect(updated.ok).toBe(false);
    expect(deleted.ok).toBe(false);
  });
});

describe("统一会话生命周期", () => {
  it("建课、加课和退课只维护统一会话模型", async () => {
    const created = await asRole(
      "authenticated",
      `insert into public.courses (school_id, code, title, term)
       values ('uw-madison', 'CS 577', 'Algorithms', '2026-fall')
       returning id::text`,
      BOB,
    );
    expect(created.ok).toBe(true);
    const newCourseId = (created as { ok: true; rows: { id: string }[] }).rows[0].id;

    const conversation = await database.query<{ id: string }>(
      `select c.id::text
       from public.conversations c
       join public.course_conversations cc on cc.conversation_id = c.id
       where cc.course_id = '${newCourseId}' and c.kind = 'course'`,
    );
    expect(conversation.rows).toHaveLength(1);

    const joined = await asRole(
      "authenticated",
      `insert into public.course_members (course_id)
       values ('${newCourseId}')`,
      BOB,
    );
    expect(joined.ok).toBe(true);
    expect(
      (
        await database.query(
          `select user_id from public.conversation_members
           where conversation_id = '${conversation.rows[0].id}'`,
        )
      ).rows,
    ).toHaveLength(1);

    const left = await asRole(
      "authenticated",
      `delete from public.course_members where course_id = '${newCourseId}'`,
      BOB,
    );
    expect(left.ok).toBe(true);
    expect(
      (
        await database.query(
          `select user_id from public.conversation_members
           where conversation_id = '${conversation.rows[0].id}'`,
        )
      ).rows,
    ).toHaveLength(0);

    const legacyTables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('groups', 'group_members')`,
    );
    expect(legacyTables.rows).toEqual([]);
  });

  it("私聊成员对自动建立两个成员并且全局唯一", async () => {
    const conversationId = await createDirectConversation(ALICE, DAVE);

    const members = await database.query<{ user_id: string }>(
      `select user_id::text from public.conversation_members
       where conversation_id = '${conversationId}' order by user_id`,
    );
    expect(members.rows).toEqual([{ user_id: ALICE }, { user_id: DAVE }]);

    await expect(
      database.exec(
        `insert into public.conversation_members (conversation_id, user_id)
         values ('${conversationId}', '${BOB}')`,
      ),
    ).rejects.toThrow();

    await expect(
      database.exec(`
        with duplicate_conversation as (
          insert into public.conversations (kind)
          values ('direct') returning id
        )
        insert into public.direct_conversations
          (conversation_id, member_low, member_high)
        select id, '${ALICE}', '${DAVE}' from duplicate_conversation
      `),
    ).rejects.toThrow();

    await database.exec(
      `delete from public.conversations where id = '${conversationId}'`,
    );
  });

  it("账号注销只清理成员状态，不删除私聊会话或对方历史", async () => {
    const conversationId = await createDirectConversation(ALICE, DAVE);
    const message = await database.query<{ id: number }>(
      `insert into public.messages (conversation_id, sender_id, body)
       values ('${conversationId}', '${ALICE}', 'direct history')
       returning id`,
    );

    await expect(
      database.exec(
        `update public.conversation_members
         set last_read_message_id = 41
         where conversation_id = '${conversationId}' and user_id = '${DAVE}'`,
      ),
    ).rejects.toThrow();

    const deniedBeforePrivatePolicies = await asRole(
      "authenticated",
      `select id from public.messages
       where conversation_id = '${conversationId}'`,
      DAVE,
    );
    expect(
      deniedBeforePrivatePolicies.ok && deniedBeforePrivatePolicies.rows,
    ).toEqual([]);
    const deniedDirectSend = await asRole(
      "authenticated",
      `insert into public.messages (conversation_id, body)
       values ('${conversationId}', 'private not open yet')`,
      DAVE,
    );
    expect(deniedDirectSend.ok).toBe(false);

    await database.exec(`delete from auth.users where id = '${ALICE}'`);

    const retained = await database.query(
      `select c.id::text, dc.member_low::text, dc.member_high::text,
              cm.user_id::text, m.id::int, m.sender_id::text, m.body
       from public.conversations c
       join public.direct_conversations dc on dc.conversation_id = c.id
       join public.conversation_members cm on cm.conversation_id = c.id
       join public.messages m on m.conversation_id = c.id
       where c.id = '${conversationId}' and m.id = ${message.rows[0].id}`,
    );
    expect(retained.rows).toEqual([
      {
        id: message.rows[0].id,
        member_high: DAVE,
        member_low: null,
        user_id: DAVE,
        sender_id: null,
        body: "direct history",
      },
    ]);
  });
});
