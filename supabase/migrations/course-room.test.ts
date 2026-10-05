import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 课程群聊页的合并读取（202610050002）。
 *
 * get_course_room 把「访问校验 → 会话归档 → 名单与昵称 → 最近消息与发送者昵称」四轮请求
 * 合成一次调用。这里用测试里复刻的旧逻辑（逐表按调用者的 RLS 查询）逐项对照，
 * 确认结果一致、可见范围没有放宽。按真实顺序跑完全部 migration。
 */

const ALICE = "e1111111-1111-4111-8111-111111111111"; // wisc，课程成员
const BOB = "e2222222-2222-4222-8222-222222222222"; // wisc，课程成员
const CAROL = "e3333333-3333-4333-8333-333333333333"; // umich
const OUTSIDER = "e4444444-4444-4444-8444-444444444444"; // wisc，不是任何课程的成员

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

async function rows(userId: string | null, sql: string): Promise<Row[]> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

type Room = {
  course: { id: string; school_id: string; code: string; title: string; term: string };
  conversation_id: string;
  archived: boolean;
  members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
  messages: {
    id: number;
    sender_id: string | null;
    sender_name: string | null;
    body: string;
    created_at: string;
    client_message_id: string | null;
  }[];
};

async function viaFunction(
  userId: string | null,
  course: string,
  school: string,
  limit?: number,
): Promise<Room | null> {
  const args = limit === undefined ? "" : `, ${limit}`;
  const [row] = await rows(
    userId,
    `select public.get_course_room('${course}', '${school}'${args}) as room`,
  );
  return (row?.room as Room | null) ?? null;
}

/** 合并前 getCourseRoom 的逻辑：逐表按调用者的 RLS 查询，在应用层拼装。 */
async function viaLegacyQueries(
  userId: string,
  course: string,
  school: string,
  limit = 50,
): Promise<Room | null> {
  const [membership] = await rows(
    userId,
    `select course_id from public.course_members
     where course_id = '${course}' and user_id = '${userId}'`,
  );
  if (!membership) return null;
  const [courseRow] = await rows(
    userId,
    `select id, school_id, code, title, term from public.courses
     where id = '${course}' and school_id = '${school}'`,
  );
  if (!courseRow) return null;
  const [link] = await rows(
    userId,
    `select conversation_id from public.course_conversations where course_id = '${course}'`,
  );
  if (!link) return null;
  const [conversation] = await rows(
    userId,
    `select archived_at from public.conversations where id = '${link.conversation_id}'`,
  );
  if (!conversation) return null;

  const memberRows = await rows(
    userId,
    `select user_id from public.conversation_members
     where conversation_id = '${link.conversation_id}' order by joined_at, user_id`,
  );
  const memberIds = memberRows.map((row) => `'${row.user_id}'`).join(", ");
  const profiles = memberIds
    ? await rows(
        userId,
        `select id, display_name, avatar_url from public.profiles where id in (${memberIds})`,
      )
    : [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const messageRows = await rows(
    userId,
    `select id, sender_id, body, created_at, client_message_id from public.messages
     where conversation_id = '${link.conversation_id}' order by id desc limit ${limit}`,
  );
  const senderIds = [
    ...new Set(messageRows.flatMap((row) => (row.sender_id ? [`'${row.sender_id}'`] : []))),
  ].join(", ");
  const senders = senderIds
    ? await rows(
        userId,
        `select id, display_name from public.profiles where id in (${senderIds})`,
      )
    : [];
  const senderName = new Map(senders.map((profile) => [profile.id, profile.display_name]));

  return JSON.parse(
    JSON.stringify({
      course: courseRow,
      conversation_id: link.conversation_id,
      archived: conversation.archived_at !== null,
      members: memberRows.map((row) => ({
        user_id: row.user_id,
        display_name: profileById.get(row.user_id)?.display_name ?? null,
        avatar_url: profileById.get(row.user_id)?.avatar_url ?? null,
      })),
      messages: messageRows
        .map((row) => ({
          id: row.id,
          sender_id: row.sender_id,
          sender_name: row.sender_id ? (senderName.get(row.sender_id) ?? null) : null,
          body: row.body,
          created_at: row.created_at,
          client_message_id: row.client_message_id,
        }))
        .reverse(),
    }),
  );
}

/** PGlite 把 timestamptz 返回成 Date，jsonb 里是字符串；比较时都转成毫秒。 */
function normalize(room: Room | null) {
  if (!room) return room;
  return {
    ...room,
    messages: room.messages.map((message) => ({
      ...message,
      created_at: new Date(message.created_at).getTime(),
    })),
  };
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
      ('${OUTSIDER}', 'outsider@wisc.edu', now());
    insert into public.profiles (id, display_name, avatar_url) values
      ('${ALICE}', 'Alice', 'alice.png'), ('${BOB}', 'Bob', null),
      ('${CAROL}', 'Carol', null), ('${OUTSIDER}', 'Outsider', null);

    insert into public.courses (school_id, code, title, term) values
      ('uw-madison', 'CS 100', 'Intro', '2026-fall'),
      ('uw-madison', 'CS 200', 'Archived chat', '2026-fall'),
      ('uw-madison', 'NOLINK 1', 'No conversation link', '2026-fall'),
      ('umich', 'EECS 280', 'Michigan', '2026-fall');
  `);

  for (const code of ["CS 100", "CS 200", "NOLINK 1", "EECS 280"]) {
    courseIds[code] = (
      await database.query<{ id: string }>(
        `select id::text from public.courses where code = '${code}'`,
      )
    ).rows[0].id;
  }

  // 加入课程走真实路径：以成员身份插入，由触发器惰性创建会话。
  for (const [user, code] of [
    [ALICE, "CS 100"],
    [BOB, "CS 100"],
    [ALICE, "CS 200"],
    [CAROL, "EECS 280"],
  ] as const) {
    const joined = await asUser(
      user,
      `insert into public.course_members (course_id) values ('${courseIds[code]}')`,
    );
    if (!joined.ok) throw new Error(joined.error);
  }

  await database.exec(`
    -- CS 100：60 条消息（超过默认 50 条），其中一条发送者已注销、一条带 client_message_id。
    insert into public.messages (conversation_id, sender_id, body)
    select links.conversation_id,
           case when n % 2 = 0 then '${ALICE}'::uuid else '${BOB}'::uuid end,
           'msg ' || n
    from generate_series(1, 60) n,
         public.course_conversations links
    where links.course_id = '${courseIds["CS 100"]}';
    update public.messages set sender_id = null where body = 'msg 58';
    update public.messages set client_message_id = '11111111-1111-4111-8111-111111111111'
    where body = 'msg 59';

    -- CS 200：会话已归档，没有消息。
    update public.conversations set archived_at = now()
    where id = (select conversation_id from public.course_conversations
                where course_id = '${courseIds["CS 200"]}');

    -- NOLINK 1：有成员但没有会话关联。
    insert into public.course_members (course_id, user_id)
    values ('${courseIds["NOLINK 1"]}', '${ALICE}');
    delete from public.course_conversations where course_id = '${courseIds["NOLINK 1"]}';
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("get_course_room", () => {
  it("与合并前逐表查询的结果逐项一致", async () => {
    const cases: [string, string, string, number | undefined][] = [
      [ALICE, "CS 100", "uw-madison", undefined],
      [BOB, "CS 100", "uw-madison", undefined],
      [ALICE, "CS 200", "uw-madison", undefined],
      [ALICE, "CS 100", "uw-madison", 10],
      [ALICE, "CS 100", "uw-madison", 200],
      [ALICE, "NOLINK 1", "uw-madison", undefined],
      [OUTSIDER, "CS 100", "uw-madison", undefined],
      [ALICE, "CS 100", "umich", undefined],
      [CAROL, "CS 100", "umich", undefined],
      [CAROL, "EECS 280", "umich", undefined],
    ];
    for (const [userId, code, school, limit] of cases) {
      const course = courseIds[code];
      expect(
        normalize(await viaFunction(userId, course, school, limit)),
        `${userId} @ ${code} / ${school} / ${limit}`,
      ).toEqual(normalize(await viaLegacyQueries(userId, course, school, limit ?? 50)));
    }
  });

  it("返回课程、成员昵称与头像、最近 50 条消息（升序）和归档状态", async () => {
    const room = (await viaFunction(ALICE, courseIds["CS 100"], "uw-madison"))!;

    expect(room.course).toMatchObject({ code: "CS 100", school_id: "uw-madison" });
    expect(room.archived).toBe(false);
    expect(room.members.map((member) => [member.display_name, member.avatar_url]).sort()).toEqual([
      ["Alice", "alice.png"],
      ["Bob", null],
    ]);
    expect(room.messages).toHaveLength(50);
    expect(room.messages[0].body).toBe("msg 11");
    expect(room.messages[49].body).toBe("msg 60");
    // 发送者已注销：没有 sender_id，也没有昵称。
    expect(room.messages.find((message) => message.body === "msg 58")).toMatchObject({
      sender_id: null,
      sender_name: null,
    });
    expect(room.messages.find((message) => message.body === "msg 59")).toMatchObject({
      client_message_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("归档的课程会话返回 archived: true", async () => {
    const room = (await viaFunction(ALICE, courseIds["CS 200"], "uw-madison"))!;
    expect(room.archived).toBe(true);
    expect(room.messages).toEqual([]);
  });

  it("不是成员、课程不在该学校、没有会话关联时返回空", async () => {
    expect(await viaFunction(OUTSIDER, courseIds["CS 100"], "uw-madison")).toBeNull();
    expect(await viaFunction(ALICE, courseIds["CS 100"], "umich")).toBeNull();
    expect(await viaFunction(ALICE, courseIds["NOLINK 1"], "uw-madison")).toBeNull();
    expect(await viaFunction(null, courseIds["CS 100"], "uw-madison")).toBeNull();
  });

  it("消息条数被限制在 1 到 200，不能当作无限读取接口", async () => {
    const huge = (await viaFunction(ALICE, courseIds["CS 100"], "uw-madison", 100000))!;
    expect(huge.messages).toHaveLength(60);
    const zero = (await viaFunction(ALICE, courseIds["CS 100"], "uw-madison", 0))!;
    expect(zero.messages).toHaveLength(1);
    const negative = (await viaFunction(ALICE, courseIds["CS 100"], "uw-madison", -5))!;
    expect(negative.messages).toHaveLength(1);
  });

  it("显式按 auth.uid() 过滤：即使调用者绕过 RLS，也不能读到别人的课程", async () => {
    // service_role 带 bypassrls。去掉 auth.uid() 过滤，它能读到任何人的课程会话。
    await database.exec(
      `set role service_role;
       select set_config('request.jwt.claim.sub', '${OUTSIDER}', false);`,
    );
    const result = await run(
      `select public.get_course_room('${courseIds["CS 100"]}', 'uw-madison') as room`,
    );

    expect(result).toEqual({ ok: true, rows: [{ room: null }] });
  });

  it("只有已登录用户可以执行，未登录角色不行", async () => {
    await database.exec("set role anon;");
    const anon = await run(
      `select public.get_course_room('${courseIds["CS 100"]}', 'uw-madison')`,
    );
    expect(anon.ok).toBe(false);

    const authenticated = await asUser(
      ALICE,
      `select public.get_course_room('${courseIds["CS 100"]}', 'uw-madison')`,
    );
    expect(authenticated.ok).toBe(true);
  });
});
