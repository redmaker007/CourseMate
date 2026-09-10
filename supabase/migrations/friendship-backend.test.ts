import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const INCOMPLETE = "55555555-5555-4555-8555-555555555555";

const BASE_MIGRATIONS = [
  "202609050001_email_otp_request.sql",
  "202609050002_member_account_binding.sql",
  "202609070001_course_and_chat_schema.sql",
  "202609070002_course_and_chat_rls.sql",
  "202609090001_profile_onboarding.sql",
  "202609100001_unified_conversation_core.sql",
] as const;

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;

async function applyMigration(name: string) {
  const sql = await readFile(
    resolve(process.cwd(), "supabase/migrations", name),
    "utf8",
  );
  await database.exec(sql);
}

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

async function createAcceptedFriendship() {
  const sent = await asUser(
    ALICE,
    `select * from public.send_friend_request('${BOB}', 'hello')`,
  );
  const requestId = sent.ok ? String(sent.rows[0].request_id) : "";
  const accepted = await asUser(
    BOB,
    `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
  );
  return {
    requestId,
    conversationId: accepted.ok ? String(accepted.rows[0].conversation_id) : "",
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
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
  `);
  for (const migration of BASE_MIGRATIONS) await applyMigration(migration);

  await database.exec(`
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('umich', '密歇根大学', 'University of Michigan', true);
    insert into public.school_email_domains (domain, school_id)
    values ('umich.edu', 'umich');

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
      ('uw-madison', 'TEST00', '测试00-测试课程', '2026-fall', '${ALICE}'),
      ('umich', 'TEST00', '测试00-测试课程', '2026-fall', '${CAROL}');
    insert into public.course_members (course_id, user_id)
    select id, member_id
    from public.courses
    cross join (values ('${ALICE}'::uuid), ('${BOB}'::uuid)) members(member_id)
    where school_id = 'uw-madison';
  `);

  await applyMigration("202609100002_course_flow.sql");
  await applyMigration("202609100003_friendship_backend.sql");
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.exec(
    `update public.profiles set display_name = 'Bob' where id = '${BOB}'`,
  );
  await database.exec(`
    update public.friend_rate_limit_config
    set minute_limit = 5, hour_limit = 30
  `);
  await database.exec("delete from public.friend_preferences;");
  await database.exec("delete from public.friendships;");
  await database.exec("delete from public.member_blocks;");
  await database.exec("delete from public.conversations where kind = 'direct';");
  await database.exec("delete from public.friend_rate_limit_buckets;");
  await database.exec("delete from public.friend_request_active_pairs;");
  await database.exec("delete from public.friend_requests;");
});

describe("好友发现与关系状态数据库", () => {
  it("按规范化完整邮箱发现同校成员且结果不包含邮箱", async () => {
    const result = await asUser(
      ALICE,
      "select * from public.find_member_by_email('  BOB@WISC.EDU  ')",
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.ok && result.rows).toEqual([
      {
        result_status: "found",
        member_id: BOB,
        display_name: "Bob",
        avatar_url: null,
        major: null,
        grad_year: null,
        shared_courses: [
          { code: "TEST00", id: expect.any(String), title: "测试00-测试课程" },
        ],
        relationship_status: "none",
        incoming_request_id: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("bob@wisc.edu");
  });

  it("阻止未完成 onboarding、跨校发现，并原子执行默认搜索限流", async () => {
    const incomplete = await asUser(
      INCOMPLETE,
      "select result_status from public.find_member_by_email('bob@wisc.edu')",
    );
    const crossSchool = await asUser(
      ALICE,
      "select result_status from public.find_member_by_email('carol@umich.edu')",
    );
    expect(incomplete.ok && incomplete.rows).toEqual([
      { result_status: "onboarding_required" },
    ]);
    expect(crossSchool.ok && crossSchool.rows).toEqual([
      { result_status: "not_found" },
    ]);

    await database.exec("delete from public.friend_rate_limit_buckets;");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await asUser(
        ALICE,
        "select result_status from public.find_member_by_email('bob@wisc.edu')",
      );
      expect(allowed.ok && allowed.rows).toEqual([{ result_status: "found" }]);
    }
    const limited = await asUser(
      ALICE,
      "select result_status from public.find_member_by_email('bob@wisc.edu')",
    );
    expect(limited.ok && limited.rows).toEqual([
      { result_status: "rate_limited" },
    ]);
  });

  it("创建唯一有效申请并在数据库执行身份、学校和 300 字边界", async () => {
    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request(
        '${BOB}', '  ${"中".repeat(300)}  '
      )`,
    );
    expect(sent.ok).toBe(true);
    expect(sent.ok && sent.rows).toEqual([
      { result_status: "sent", request_id: expect.any(String) },
    ]);
    const requestId = sent.ok ? String(sent.rows[0].request_id) : "";

    const duplicate = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'again')`,
    );
    const reverse = await asUser(
      BOB,
      `select * from public.send_friend_request('${ALICE}', 'reverse')`,
    );
    expect(duplicate.ok && duplicate.rows).toEqual([
      { result_status: "already_pending", request_id: requestId },
    ]);
    expect(reverse.ok && reverse.rows).toEqual([
      { result_status: "incoming_request", request_id: requestId },
    ]);

    const tooLong = await asUser(
      ALICE,
      `select result_status from public.send_friend_request(
        '${BOB}', '${"中".repeat(301)}'
      )`,
    );
    const self = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${ALICE}', 'self')`,
    );
    const crossSchool = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${CAROL}', 'cross')`,
    );
    const incomplete = await asUser(
      INCOMPLETE,
      `select result_status from public.send_friend_request('${BOB}', 'hello')`,
    );
    expect(tooLong.ok && tooLong.rows).toEqual([{ result_status: "invalid" }]);
    expect(self.ok && self.rows).toEqual([{ result_status: "invalid_target" }]);
    expect(crossSchool.ok && crossSchool.rows).toEqual([
      { result_status: "not_available" },
    ]);
    expect(incomplete.ok && incomplete.rows).toEqual([
      { result_status: "onboarding_required" },
    ]);

    const forged = await asUser(
      ALICE,
      `insert into public.friend_requests
        (requester_id, recipient_id, pair_low, pair_high, message, expires_at)
       values ('${BOB}', '${ALICE}', '${ALICE}', '${BOB}', 'forged', now() + interval '3 days')`,
    );
    expect(forged.ok).toBe(false);

    const strangerHistory = await asUser(
      CAROL,
      "select id from public.friend_requests",
    );
    expect(strangerHistory.ok && strangerHistory.rows).toEqual([]);
  });

  it("接受申请在一个事务内幂等建立好友、唯一私聊和可追溯首消息", async () => {
    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', '  let us connect  ')`,
    );
    const requestId = sent.ok ? String(sent.rows[0].request_id) : "";

    const forgedAcceptance = await asUser(
      ALICE,
      `select result_status from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    expect(forgedAcceptance.ok && forgedAcceptance.rows).toEqual([
      { result_status: "not_recipient" },
    ]);

    const accepted = await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    expect(accepted.ok && accepted.rows).toEqual([
      { result_status: "accepted", conversation_id: expect.any(String) },
    ]);
    const conversationId = accepted.ok
      ? String(accepted.rows[0].conversation_id)
      : "";

    const retried = await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    expect(retried.ok && retried.rows).toEqual([
      { result_status: "accepted", conversation_id: conversationId },
    ]);

    const invariant = await database.query(`
      select
        (select count(*)::int from public.friendships where active) as friendships,
        (select count(*)::int from public.direct_conversations) as conversations,
        (select count(*)::int from public.messages
          where source_friend_request_id = '${requestId}') as source_messages,
        (select bool_and(message.created_at = request.created_at)
          from public.messages message
          join public.friend_requests request
            on request.id = message.source_friend_request_id
          where request.id = '${requestId}') as preserved_time
    `);
    expect(invariant.rows).toEqual([
      {
        friendships: 1,
        conversations: 1,
        source_messages: 1,
        preserved_time: true,
      },
    ]);

    const alreadyFriends = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'duplicate friendship')`,
    );
    expect(alreadyFriends.ok && alreadyFriends.rows).toEqual([
      { result_status: "already_friends" },
    ]);
  });

  it("保留拒绝和过期申请历史且不阻塞合法的新申请", async () => {
    const first = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'first')`,
    );
    const firstId = first.ok ? String(first.rows[0].request_id) : "";
    const rejected = await asUser(
      BOB,
      `select result_status from public.respond_to_friend_request('${firstId}', 'reject')`,
    );
    expect(rejected.ok && rejected.rows).toEqual([
      { result_status: "rejected" },
    ]);

    const second = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'second')`,
    );
    const secondId = second.ok ? String(second.rows[0].request_id) : "";
    await database.exec(`
      update public.friend_requests
      set created_at = now() - interval '4 days',
          expires_at = now() - interval '1 day'
      where id = '${secondId}'
    `);
    const expired = await asUser(
      BOB,
      `select result_status from public.respond_to_friend_request('${secondId}', 'accept')`,
    );
    expect(expired.ok && expired.rows).toEqual([
      { result_status: "expired" },
    ]);

    const third = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'third')`,
    );
    expect(third.ok && third.rows).toEqual([{ result_status: "sent" }]);

    const history = await asUser(
      ALICE,
      "select status from public.friend_requests order by created_at, id",
    );
    expect(history.ok && history.rows.map((row) => row.status).sort()).toEqual([
      "expired",
      "pending",
      "rejected",
    ]);

    const safeHistory = await asUser(
      ALICE,
      "select direction, display_name, status from public.list_friend_requests() order by created_at, request_id",
    );
    expect(safeHistory.ok).toBe(true);
    expect(
      safeHistory.ok && safeHistory.rows.map((row) => row.status).sort(),
    ).toEqual(["expired", "pending", "rejected"]);
    expect(JSON.stringify(safeHistory)).not.toContain("@wisc.edu");
  });

  it("备注和屏蔽状态仅归设置者所有，隐藏只影响普通好友列表", async () => {
    await createAcceptedFriendship();

    const note = await asUser(
      ALICE,
      `select public.set_friend_note('${BOB}', '  ${"中".repeat(15)}  ') as status`,
    );
    const tooLong = await asUser(
      ALICE,
      `select public.set_friend_note('${BOB}', '${"中".repeat(16)}') as status`,
    );
    expect(note.ok && note.rows).toEqual([{ status: "saved" }]);
    expect(tooLong.ok && tooLong.rows).toEqual([{ status: "invalid" }]);

    const hidden = await asUser(
      ALICE,
      `select public.set_friend_hidden('${BOB}', true) as status`,
    );
    expect(hidden.ok && hidden.rows).toEqual([{ status: "saved" }]);
    const normalList = await asUser(
      ALICE,
      "select member_id from public.list_friends(false)",
    );
    const filteredList = await asUser(
      ALICE,
      "select member_id, effective_name, hidden from public.list_friends(true)",
    );
    expect(normalList.ok && normalList.rows).toEqual([]);
    expect(filteredList.ok && filteredList.rows).toEqual([
      { member_id: BOB, effective_name: "中".repeat(15), hidden: true },
    ]);

    const otherSidePreferences = await asUser(
      BOB,
      "select owner_id from public.friend_preferences",
    );
    expect(otherSidePreferences.ok && otherSidePreferences.rows).toEqual([]);

    const cleared = await asUser(
      ALICE,
      `select public.set_friend_note('${BOB}', '   ') as status`,
    );
    await database.exec(
      `update public.profiles set display_name = 'Robert' where id = '${BOB}'`,
    );
    const fallback = await asUser(
      ALICE,
      "select effective_name from public.list_friends(true)",
    );
    expect(cleared.ok && cleared.rows).toEqual([{ status: "cleared" }]);
    expect(fallback.ok && fallback.rows).toEqual([
      { effective_name: "Robert" },
    ]);
  });

  it("任一方向拉黑会阻止申请和双方发送资格但保留好友关系", async () => {
    await createAcceptedFriendship();

    const blocked = await asUser(
      BOB,
      `select public.set_member_blocked('${ALICE}', true) as status`,
    );
    expect(blocked.ok && blocked.rows).toEqual([{ status: "saved" }]);

    const aliceStatus = await asUser(
      ALICE,
      `select public.friend_relationship_status('${BOB}') as status`,
    );
    const bobStatus = await asUser(
      BOB,
      `select public.friend_relationship_status('${ALICE}') as status`,
    );
    expect(aliceStatus.ok && aliceStatus.rows).toEqual([{ status: "blocked" }]);
    expect(bobStatus.ok && bobStatus.rows).toEqual([{ status: "blocked" }]);

    const listStatus = await asUser(
      ALICE,
      "select send_status from public.list_friends(false)",
    );
    expect(listStatus.ok && listStatus.rows).toEqual([
      { send_status: "blocked" },
    ]);

    const activeFriendship = await asUser(
      ALICE,
      "select active from public.friendships",
    );
    const hiddenBlockDirection = await asUser(
      ALICE,
      "select blocker_id from public.member_blocks",
    );
    expect(activeFriendship.ok && activeFriendship.rows).toEqual([
      { active: true },
    ]);
    expect(hiddenBlockDirection.ok && hiddenBlockDirection.rows).toEqual([]);

    const unblocked = await asUser(
      BOB,
      `select public.set_member_blocked('${ALICE}', false) as status`,
    );
    expect(unblocked.ok && unblocked.rows).toEqual([{ status: "cleared" }]);
    const restored = await asUser(
      ALICE,
      `select public.friend_relationship_status('${BOB}') as status`,
    );
    expect(restored.ok && restored.rows).toEqual([{ status: "friend" }]);
  });

  it("非好友被任一方向拉黑后不能创建或接受申请", async () => {
    await asUser(
      BOB,
      `select public.set_member_blocked('${ALICE}', true)`,
    );
    const blockedRequest = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'hello')`,
    );
    expect(blockedRequest.ok && blockedRequest.rows).toEqual([
      { result_status: "blocked" },
    ]);

    await asUser(
      BOB,
      `select public.set_member_blocked('${ALICE}', false)`,
    );
    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'hello again')`,
    );
    const requestId = sent.ok ? String(sent.rows[0].request_id) : "";
    await asUser(
      BOB,
      `select public.set_member_blocked('${ALICE}', true)`,
    );
    const blockedAcceptance = await asUser(
      BOB,
      `select result_status from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    expect(blockedAcceptance.ok && blockedAcceptance.rows).toEqual([
      { result_status: "blocked" },
    ]);
  });

  it("删除好友保留历史并在重新添加时恢复同一会话且不恢复备注", async () => {
    const first = await createAcceptedFriendship();
    await asUser(
      ALICE,
      `select public.set_friend_note('${BOB}', 'Old Bob')`,
    );
    await asUser(
      BOB,
      `select public.set_friend_note('${ALICE}', 'Old Alice')`,
    );

    const removed = await asUser(
      ALICE,
      `select public.remove_friend('${BOB}') as status`,
    );
    expect(removed.ok && removed.rows).toEqual([{ status: "removed" }]);
    const afterRemoval = await database.query(`
      select
        (select active from public.friendships) as active,
        (select count(*)::int from public.friend_preferences) as preferences,
        (select count(*)::int from public.direct_conversations) as conversations,
        (select count(*)::int from public.messages
          where conversation_id = '${first.conversationId}') as messages
    `);
    expect(afterRemoval.rows).toEqual([
      { active: false, preferences: 0, conversations: 1, messages: 1 },
    ]);

    const resent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'welcome back')`,
    );
    const secondRequestId = resent.ok ? String(resent.rows[0].request_id) : "";
    const reaccepted = await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${secondRequestId}', 'accept')`,
    );
    expect(reaccepted.ok && reaccepted.rows).toEqual([
      { result_status: "accepted", conversation_id: first.conversationId },
    ]);

    const restored = await database.query(`
      select
        (select active from public.friendships) as active,
        (select count(*)::int from public.friend_preferences) as preferences,
        (select count(*)::int from public.messages
          where conversation_id = '${first.conversationId}') as messages,
        (select count(distinct source_friend_request_id)::int from public.messages
          where conversation_id = '${first.conversationId}') as sources
    `);
    expect(restored.rows).toEqual([
      { active: true, preferences: 0, messages: 2, sources: 2 },
    ]);
  });

  it("发现结果随申请和好友关系变化，并仅向好友开放完整公开 Profile", async () => {
    const sent = await asUser(
      ALICE,
      `select * from public.send_friend_request('${BOB}', 'hello')`,
    );
    const requestId = sent.ok ? String(sent.rows[0].request_id) : "";

    const outgoing = await asUser(
      ALICE,
      "select relationship_status, incoming_request_id, major from public.find_member_by_email('bob@wisc.edu')",
    );
    const incoming = await asUser(
      BOB,
      "select relationship_status, incoming_request_id from public.find_member_by_email('alice@wisc.edu')",
    );
    expect(outgoing.ok && outgoing.rows).toEqual([
      {
        relationship_status: "outgoing_request",
        incoming_request_id: null,
        major: null,
      },
    ]);
    expect(incoming.ok && incoming.rows).toEqual([
      {
        relationship_status: "incoming_request",
        incoming_request_id: requestId,
      },
    ]);

    await asUser(
      BOB,
      `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
    );
    const friend = await asUser(
      ALICE,
      "select relationship_status, major, grad_year from public.find_member_by_email('bob@wisc.edu')",
    );
    expect(friend.ok && friend.rows).toEqual([
      {
        relationship_status: "friend",
        major: "Mathematics",
        grad_year: 2028,
      },
    ]);
  });

  it("申请限流可配置且分钟、小时窗口都由共享数据库原子计数", async () => {
    await database.exec(`
      update public.friend_rate_limit_config
      set minute_limit = 100, hour_limit = 2
      where action_kind = 'friend_request'
    `);

    const first = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'one')`,
    );
    const second = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'two')`,
    );
    const third = await asUser(
      ALICE,
      `select result_status from public.send_friend_request('${BOB}', 'three')`,
    );
    expect(first.ok && first.rows).toEqual([{ result_status: "sent" }]);
    expect(second.ok && second.rows).toEqual([
      { result_status: "already_pending" },
    ]);
    expect(third.ok && third.rows).toEqual([
      { result_status: "rate_limited" },
    ]);

    const buckets = await database.query(`
      select window_seconds, request_count
      from public.friend_rate_limit_buckets
      where actor_id = '${ALICE}' and action_kind = 'friend_request'
      order by window_seconds
    `);
    expect(buckets.rows).toEqual([
      { window_seconds: 60, request_count: 3 },
      { window_seconds: 3600, request_count: 3 },
    ]);
  });

  it("认证客户端不能直接读取 auth.users 或修改关系状态表", async () => {
    const authUsers = await asUser(ALICE, "select email from auth.users");
    const friendshipWrite = await asUser(
      ALICE,
      `insert into public.friendships (pair_low, pair_high)
       values ('${ALICE}', '${BOB}')`,
    );
    const blockWrite = await asUser(
      ALICE,
      `insert into public.member_blocks (blocker_id, blocked_id)
       values ('${ALICE}', '${BOB}')`,
    );
    expect(authUsers.ok).toBe(false);
    expect(friendshipWrite.ok).toBe(false);
    expect(blockWrite.ok).toBe(false);
  });

  it("同课非好友只能直接读取有限 Profile 列，自己的完整资料仍可读取", async () => {
    const limited = await asUser(
      ALICE,
      `select id, display_name, avatar_url from public.profiles where id = '${BOB}'`,
    );
    const leaked = await asUser(
      ALICE,
      `select major, grad_year from public.profiles where id = '${BOB}'`,
    );
    const own = await asUser(
      ALICE,
      "select display_name, major, grad_year from public.get_own_profile()",
    );
    expect(limited.ok && limited.rows).toEqual([
      { id: BOB, display_name: "Bob", avatar_url: null },
    ]);
    expect(leaked.ok).toBe(false);
    expect(own.ok && own.rows).toEqual([
      { display_name: "Alice", major: "Computer Science", grad_year: 2027 },
    ]);
  });

  it("并发提交创建和接受动作仍只产生一份申请、好友、会话和首消息", async () => {
    await database.exec(`
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${ALICE}', false);
    `);
    const submitted = await Promise.all([
      database.query(
        `select * from public.send_friend_request('${BOB}', 'concurrent')`,
      ),
      database.query(
        `select * from public.send_friend_request('${BOB}', 'concurrent')`,
      ),
    ]);
    await database.exec("reset role;");
    expect(
      submitted.flatMap((result) =>
        result.rows.map((row) => (row as { result_status: string }).result_status),
      ).sort(),
    ).toEqual(["already_pending", "sent"]);
    const request = await database.query<{ id: string }>(
      "select id::text from public.friend_requests",
    );
    const requestId = request.rows[0].id;

    await database.exec(`
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${BOB}', false);
    `);
    const accepted = await Promise.all([
      database.query(
        `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
      ),
      database.query(
        `select * from public.respond_to_friend_request('${requestId}', 'accept')`,
      ),
    ]);
    await database.exec("reset role;");
    const conversationIds = accepted.flatMap((result) =>
      result.rows.map((row) => String((row as { conversation_id: string }).conversation_id)),
    );
    expect(new Set(conversationIds).size).toBe(1);

    const counts = await database.query(`
      select
        (select count(*)::int from public.friend_requests) as requests,
        (select count(*)::int from public.friendships where active) as friendships,
        (select count(*)::int from public.direct_conversations) as conversations,
        (select count(*)::int from public.messages
          where source_friend_request_id = '${requestId}') as source_messages
    `);
    expect(counts.rows).toEqual([
      { requests: 1, friendships: 1, conversations: 1, source_messages: 1 },
    ]);
  });
});
