import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * 内容过滤（202611220002）。按真实顺序跑完整迁移链，用真实角色验证：
 * 命中词表的消息、好友申请附言、显示名／专业在数据库层被拒绝（CM001），
 * 不论走 RPC 还是直接写表；词表和判定函数对学生不可见。
 */

const ALICE = "d1111111-1111-4111-8111-111111111111";
const BOB = "d2222222-2222-4222-8222-222222222222";

type Result = {
  rows: Record<string, unknown>[];
  error: { message: string; code?: string; detail?: string } | null;
};
let db: PGlite;
let courseId = "";
let conversationId = "";

async function asUser(user: string, sql: string): Promise<Result> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null };
  } catch (error) {
    const failure = error as { message: string; code?: string; detail?: string };
    return { rows: [], error: { message: failure.message.split("\n")[0], code: failure.code, detail: failure.detail } };
  } finally {
    await db.exec("reset role");
  }
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const sendCourse = (user: string, body: string) =>
  asUser(user, `select result_status, message_id::text from public.send_conversation_message('${conversationId}', ${literal(body)}, gen_random_uuid())`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text unique, email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create publication supabase_realtime; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const migrations = (await readdir(resolve(process.cwd(), "supabase/migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const file of migrations) {
    await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", file), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${ALICE}', 'alice@wisc.edu', now()), ('${BOB}', 'bob@wisc.edu', now());
    insert into public.profiles (id, display_name, major, grad_year) values
      ('${ALICE}', 'Alice', 'CS', 2027), ('${BOB}', 'Bob', 'Math', 2027);
    insert into public.courses (school_id, code, title, term) values ('uw-madison', 'CF 100', 'Filter', '2026-fall');
  `);
  courseId = (await db.query<{ id: string }>("select id::text from public.courses where code = 'CF 100'")).rows[0].id;
  for (const user of [ALICE, BOB]) {
    const joined = await asUser(user, `insert into public.course_members (course_id) values ('${courseId}')`);
    if (joined.error) throw new Error(joined.error.message);
  }
  conversationId = (await db.query<{ id: string }>(
    `select conversation_id::text as id from public.course_conversations where course_id = '${courseId}'`,
  )).rows[0].id;
});

beforeEach(async () => {
  await db.exec(`truncate public.content_filter_terms;
    delete from public.friend_request_active_pairs; delete from public.friend_requests;
    delete from public.friend_rate_limit_buckets;`);
});

afterAll(async () => {
  await db?.close();
});

async function addTerms() {
  await db.exec(`insert into public.content_filter_terms (term, match_mode) values
    (public.content_filter_term_key('垃圾 话', 'substring'), 'substring'),
    (public.content_filter_term_key('BadWord', 'word'), 'word'),
    (public.content_filter_term_key('go away now', 'word'), 'word');`);
}

describe("内容过滤：完整迁移链与真实权限", () => {
  it("词表为空时不影响正常发送", async () => {
    const sent = await sendCourse(ALICE, "垃圾话 badword");
    expect(sent.error).toBeNull();
    expect(sent.rows[0].result_status).toBe("sent");
  });

  it("课程消息命中词表时拒绝并回滚，规范化挡住空格、标点、全角和大小写变体", async () => {
    await addTerms();
    const before = (await db.query<{ count: number }>("select count(*)::int as count from public.messages")).rows[0].count;
    for (const body of ["你这垃圾话", "垃 圾-话", "ＢＡＤＷＯＲＤ!", "hey BadWord", "please GO   away, now", "垃​圾话"]) {
      const sent = await sendCourse(ALICE, body);
      expect(sent.error, body).toMatchObject({ code: "CM001", message: "content_rejected", detail: "body" });
    }
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.messages")).rows[0].count).toBe(before);

    // 整词模式不误伤包含该字母序列的正常单词；子串模式只看规范化后的连续字符。
    for (const body of ["badwordsmith is fine", "go away later", "垃圾分类"]) {
      const sent = await sendCourse(ALICE, body);
      expect(sent.error, body).toBeNull();
      expect(sent.rows[0].result_status, body).toBe("sent");
    }
  });

  it("拦截在表层生效：学生直写已被权限挡住，即使有写权限的路径也过不了触发器", async () => {
    await addTerms();
    const direct = await asUser(ALICE, `insert into public.messages (conversation_id, sender_id, body)
      values ('${conversationId}', '${ALICE}', 'badword')`);
    expect(direct.error).not.toBeNull();
    await expect(db.exec(`insert into public.messages (conversation_id, sender_id, body)
      values ('${conversationId}', '${ALICE}', 'badword')`)).rejects.toMatchObject({ code: "CM001" });
  });

  it("好友申请附言命中时拒绝，干净附言照常发送", async () => {
    await addTerms();
    const rejected = await asUser(ALICE, `select * from public.send_friend_request('${BOB}', '你个垃圾话')`);
    expect(rejected.error).toMatchObject({ code: "CM001", detail: "message" });
    expect((await db.query("select count(*)::int as count from public.friend_requests")).rows).toEqual([{ count: 0 }]);
    const sent = await asUser(ALICE, `select * from public.send_friend_request('${BOB}', 'hello from Alice')`);
    expect(sent.error).toBeNull();
  });

  it("显示名和专业命中时拒绝并指明字段；只改其他列时不重新检查旧值", async () => {
    await addTerms();
    const name = await asUser(BOB, `update public.profiles set display_name = 'Badword' where id = '${BOB}'`);
    expect(name.error).toMatchObject({ code: "CM001", detail: "display_name" });
    const major = await asUser(BOB, `update public.profiles set major = '垃圾话学' where id = '${BOB}'`);
    expect(major.error).toMatchObject({ code: "CM001", detail: "major" });

    // 词表更新前已经存在的旧显示名，不应让用户连毕业年份都改不了。
    await db.exec(`alter table public.profiles disable trigger profiles_content_filter;
      update public.profiles set display_name = 'badword' where id = '${BOB}';
      alter table public.profiles enable trigger profiles_content_filter;`);
    const year = await asUser(BOB, `update public.profiles set grad_year = 2028 where id = '${BOB}'`);
    expect(year.error).toBeNull();
    await db.exec(`update public.profiles set display_name = 'Bob' where id = '${BOB}'`);
  });

  it("学生不能读写词表，也不能直接调用判定函数试探词表", async () => {
    await addTerms();
    expect((await asUser(ALICE, "select * from public.content_filter_terms")).error?.message).toMatch(/permission denied/);
    expect((await asUser(ALICE, "insert into public.content_filter_terms (term, match_mode) values ('x', 'word')")).error?.message)
      .toMatch(/permission denied/);
    expect((await asUser(ALICE, "select public.contains_blocked_content('badword')")).error?.message).toMatch(/permission denied/);
  });

  it("词表只接受规范化后的词", async () => {
    await expect(db.exec("insert into public.content_filter_terms (term, match_mode) values ('BadWord', 'word')"))
      .rejects.toThrow(/content_filter_terms_normalized/);
    await expect(db.exec("insert into public.content_filter_terms (term, match_mode) values ('', 'substring')"))
      .rejects.toThrow(/content_filter_terms_normalized/);
  });
});
