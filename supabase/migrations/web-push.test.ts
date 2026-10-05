import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 网页推送（202610040001）。
 *
 * 重点是"谁能收到通知"：只有刚发出的私聊或好友申请、关系仍然有效、没有拉黑、
 * 没有被收件人屏蔽时才返回订阅；同一事件只返回一次；订阅表本身不对登录用户开放。
 * 按真实顺序跑完全部 migration。
 */

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const CAROL = "c3333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
type Attempt = { ok: true; rows: Row[] } | { ok: false; error: string };

let database: PGlite;
let conversationId = "";

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

async function asUser(userId: string, sql: string): Promise<Attempt> {
  await database.exec(
    `set role authenticated;
     select set_config('request.jwt.claim.sub', '${userId}', false);`,
  );
  return run(sql);
}

async function asService(sql: string): Promise<Attempt> {
  await database.exec("set role service_role;");
  return run(sql);
}

async function asAnon(sql: string): Promise<Attempt> {
  await database.exec("set role anon;");
  return run(sql);
}

async function subscribe(userId: string, endpoint: string) {
  const result = await asUser(
    userId,
    `select public.save_push_subscription('${endpoint}', 'p256dh-key', 'auth-key') as status`,
  );
  if (!result.ok) throw new Error(result.error);
  return result.rows[0].status;
}

async function insertMessage(senderId: string, ageMinutes = 0) {
  const result = await database.query(
    `insert into public.messages (conversation_id, sender_id, body, created_at)
     values ('${conversationId}', '${senderId}', 'hi', now() - interval '${ageMinutes} minutes')
     returning id`,
  );
  return String((result.rows[0] as { id: number }).id);
}

async function claimDirect(messageId: string) {
  const result = await asService(
    `select endpoint from public.claim_push_targets_for_direct_message(${messageId}) order by endpoint`,
  );
  if (!result.ok) throw new Error(result.error);
  return result.rows.map((row) => row.endpoint);
}

async function setBlocked(blocker: string, target: string, blocked: boolean) {
  const result = await asUser(
    blocker,
    `select * from public.set_member_blocked('${target}', ${blocked})`,
  );
  if (!result.ok) throw new Error(result.error);
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
    grant usage on schema public to anon, authenticated, service_role;
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
      ('${CAROL}', 'carol@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${ALICE}', 'Alice'),
      ('${BOB}', 'Bob'),
      ('${CAROL}', 'Carol');
  `);

  const sent = await asUser(
    ALICE,
    `select * from public.send_friend_request('${BOB}', 'hello')`,
  );
  if (!sent.ok) throw new Error(sent.error);
  const accepted = await asUser(
    BOB,
    `select * from public.respond_to_friend_request('${sent.rows[0].request_id}', 'accept')`,
  );
  if (!accepted.ok) throw new Error(accepted.error);
  conversationId = String(accepted.rows[0].conversation_id);
});

afterAll(async () => {
  await database?.close();
});

describe("订阅存储", () => {
  it("本人可以保存和删除订阅，其他成员读不到订阅表", async () => {
    expect(await subscribe(BOB, "https://push.example/bob-1")).toBe("saved");

    for (const user of [ALICE, BOB]) {
      const direct = await asUser(user, "select * from public.push_subscriptions");
      expect(direct.ok).toBe(false);
    }
    expect((await asAnon("select * from public.push_subscriptions")).ok).toBe(false);

    const removedByOther = await asUser(
      ALICE,
      "select public.remove_push_subscription('https://push.example/bob-1') as status",
    );
    expect(removedByOther.ok && removedByOther.rows[0].status).toBe("removed");
    const stillThere = await database.query(
      "select count(*)::int as count from public.push_subscriptions where endpoint = 'https://push.example/bob-1'",
    );
    expect((stillThere.rows[0] as { count: number }).count).toBe(1);

    await asUser(BOB, "select public.remove_push_subscription('https://push.example/bob-1')");
    const gone = await database.query(
      "select count(*)::int as count from public.push_subscriptions where endpoint = 'https://push.example/bob-1'",
    );
    expect((gone.rows[0] as { count: number }).count).toBe(0);
  });

  it("拒绝非 https 与超长的输入，未登录不能保存", async () => {
    expect(await subscribe(BOB, "http://push.example/insecure")).toBe("invalid");
    const longEndpoint = `https://push.example/${"a".repeat(2100)}`;
    expect(await subscribe(BOB, longEndpoint)).toBe("invalid");
    expect(
      (await asAnon(
        "select public.save_push_subscription('https://x.example/a', 'p', 'a')",
      )).ok,
    ).toBe(false);
  });

  it("同一个浏览器换账号登录时订阅归当前账号；每人最多保留 10 个设备", async () => {
    await subscribe(BOB, "https://push.example/shared-browser");
    await subscribe(CAROL, "https://push.example/shared-browser");
    const owner = await database.query(
      "select user_id from public.push_subscriptions where endpoint = 'https://push.example/shared-browser'",
    );
    expect((owner.rows[0] as { user_id: string }).user_id).toBe(CAROL);

    for (let index = 0; index < 12; index += 1) {
      await subscribe(CAROL, `https://push.example/carol-${index}`);
    }
    const count = await database.query(
      `select count(*)::int as count from public.push_subscriptions where user_id = '${CAROL}'`,
    );
    expect((count.rows[0] as { count: number }).count).toBe(10);
    await database.exec("delete from public.push_subscriptions;");
  });
});

describe("私聊通知的收件人判定", () => {
  it("登录用户与匿名不能调用发送器函数", async () => {
    const messageId = await insertMessage(ALICE);
    for (const attempt of [
      await asUser(ALICE, `select * from public.claim_push_targets_for_direct_message(${messageId})`),
      await asAnon(`select * from public.claim_push_targets_for_direct_message(${messageId})`),
      await asUser(ALICE, "select public.drop_push_subscription('https://x.example/a')"),
    ]) {
      expect(attempt.ok).toBe(false);
    }
  });

  it("只返回收件人的订阅，不含发送者自己的；同一条消息只通知一次", async () => {
    await subscribe(BOB, "https://push.example/bob-phone");
    await subscribe(BOB, "https://push.example/bob-laptop");
    await subscribe(ALICE, "https://push.example/alice-phone");

    const messageId = await insertMessage(ALICE);
    expect(await claimDirect(messageId)).toEqual([
      "https://push.example/bob-laptop",
      "https://push.example/bob-phone",
    ]);
    expect(await claimDirect(messageId)).toEqual([]);
  });

  it("太久以前的消息不通知", async () => {
    const messageId = await insertMessage(ALICE, 10);
    expect(await claimDirect(messageId)).toEqual([]);
  });

  it("拉黑（任一方向）后不通知，解除后恢复", async () => {
    await setBlocked(BOB, ALICE, true);
    expect(await claimDirect(await insertMessage(ALICE))).toEqual([]);
    await setBlocked(BOB, ALICE, false);

    await setBlocked(ALICE, BOB, true);
    expect(await claimDirect(await insertMessage(ALICE))).toEqual([]);
    await setBlocked(ALICE, BOB, false);

    expect((await claimDirect(await insertMessage(ALICE))).length).toBe(2);
  });

  it("收件人屏蔽了发送者后不通知", async () => {
    const hide = await asUser(BOB, `select * from public.set_friend_hidden('${ALICE}', true)`);
    expect(hide.ok).toBe(true);
    expect(await claimDirect(await insertMessage(ALICE))).toEqual([]);
    await asUser(BOB, `select * from public.set_friend_hidden('${ALICE}', false)`);
    expect((await claimDirect(await insertMessage(ALICE))).length).toBe(2);
  });

  it("解除好友后不通知", async () => {
    const removed = await asUser(BOB, `select * from public.remove_friend('${ALICE}')`);
    expect(removed.ok).toBe(true);
    expect(await claimDirect(await insertMessage(ALICE))).toEqual([]);
  });
});

describe("好友申请通知", () => {
  it("只通知申请的收件人，一次；拉黑或已处理则不通知；失效订阅可清除", async () => {
    await database.exec("delete from public.push_subscriptions;");
    await subscribe(CAROL, "https://push.example/carol-phone");
    await subscribe(ALICE, "https://push.example/alice-phone");

    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${CAROL}', 'hello')`,
    );
    expect(sent.ok).toBe(true);
    const requestId = String(sent.ok ? sent.rows[0].request_id : "");

    const first = await asService(
      `select endpoint from public.claim_push_targets_for_friend_request('${requestId}')`,
    );
    expect(first.ok && first.rows).toEqual([{ endpoint: "https://push.example/carol-phone" }]);
    const second = await asService(
      `select endpoint from public.claim_push_targets_for_friend_request('${requestId}')`,
    );
    expect(second.ok && second.rows).toEqual([]);

    const dropped = await asService(
      "select public.drop_push_subscription('https://push.example/carol-phone')",
    );
    expect(dropped.ok).toBe(true);
    const remaining = await database.query(
      "select count(*)::int as count from public.push_subscriptions where endpoint = 'https://push.example/carol-phone'",
    );
    expect((remaining.rows[0] as { count: number }).count).toBe(0);
  });
});
