import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 管理员跨校测试（202609120002）。
 *
 * 登录仍按真实邮箱归属，课程与社交功能按数据库里的「当前学校」判断。这里验证
 * 权限在切回本校、撤销管理员、关闭学校之后都会收回——课程消息与私聊共用消息表，
 * 只改页面上的学校名称挡不住旧页面、直接 REST 调用或 Realtime。
 *
 * 按真实顺序跑完全部 migration，测试桩与其他集成测试一样复刻 Supabase 的
 * default privileges。
 */

const OWNER = "b1111111-1111-4111-8111-111111111111"; // wisc，所有者
const ADMIN = "b2222222-2222-4222-8222-222222222222"; // umich 邮箱，管理员
const UW_STUDENT = "b3333333-3333-4333-8333-333333333333"; // wisc，普通成员
const UW_OTHER = "b4444444-4444-4444-8444-444444444444"; // wisc，普通成员
const UM_STUDENT = "b5555555-5555-4555-8555-555555555555"; // umich，普通成员
const UW_STRANGER = "b6666666-6666-4666-8666-666666666666"; // wisc，与管理员没有任何往来

const DENIED = "没有权限执行这个管理操作";

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;
let uwCourse: string;
let uwConversation: string;

async function run(sql: string): Promise<Attempt> {
  try {
    const result = await database.query(sql);
    return { ok: true, rows: result.rows as Record<string, unknown>[] };
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

async function rows<T = Record<string, unknown>>(userId: string, sql: string): Promise<T[]> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return result.rows as T[];
}

async function value<T = unknown>(userId: string, sql: string): Promise<T> {
  const [row] = await rows(userId, sql);
  return Object.values(row ?? {})[0] as T;
}

function errorOf(attempt: Attempt): string | null {
  return attempt.ok ? null : attempt.error;
}

const currentSchool = (userId: string) =>
  value<string>(userId, "select public.current_school_id()");

const switchSchool = (userId: string, school: string | null) =>
  asUser(
    userId,
    `select public.admin_set_test_school(${school === null ? "null" : `'${school}'`})`,
  );

async function switchOrThrow(userId: string, school: string | null) {
  const result = await switchSchool(userId, school);
  if (!result.ok) throw new Error(result.error);
}

const sendStatus = (userId: string, conversation: string, body: string) =>
  value<string>(
    userId,
    `select result_status from public.send_conversation_message(
       '${conversation}', '${body}', gen_random_uuid())`,
  );

const visibleMessages = (userId: string, conversation: string) =>
  value<number>(
    userId,
    `select count(id)::int from public.messages where conversation_id = '${conversation}'`,
  );

async function superuser<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await database.query(sql)).rows as T[];
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
      ('${OWNER}', 'owner@wisc.edu', now()),
      ('${ADMIN}', 'admin@umich.edu', now()),
      ('${UW_STUDENT}', 'student@wisc.edu', now()),
      ('${UW_OTHER}', 'other@wisc.edu', now()),
      ('${UM_STUDENT}', 'student@umich.edu', now()),
      ('${UW_STRANGER}', 'stranger@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${OWNER}', 'Owner'),
      ('${ADMIN}', 'Admin'),
      ('${UW_STUDENT}', 'UW Student'),
      ('${UW_OTHER}', 'UW Other'),
      ('${UM_STUDENT}', 'UM Student'),
      ('${UW_STRANGER}', 'UW Stranger');
    insert into public.platform_roles (user_id, role) values
      ('${OWNER}', 'owner'),
      ('${ADMIN}', 'admin');
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('closed-u', '未开放大学', 'Closed University', false);
    insert into public.courses (school_id, code, title, term) values
      ('uw-madison', 'COMP SCI 400', 'Programming III', '2026-fall'),
      ('umich', 'EECS 280', 'Programming and Data Structures', '2026-fall');
  `);

  const [course] = await superuser<{ id: string; conversation_id: string }>(`
    select courses.id::text, links.conversation_id::text
    from public.courses courses
    join public.course_conversations links on links.course_id = courses.id
    where courses.code = 'COMP SCI 400'
  `);
  uwCourse = course.id;
  uwConversation = course.conversation_id;

  // UW 学生照常加入自己学校的课
  await database.exec(
    `insert into public.course_members (course_id, user_id) values ('${uwCourse}', '${UW_STUDENT}')`,
  );
});

afterAll(async () => {
  await database?.close();
});

describe("切换入口", () => {
  it("未登录用户执行不了；内部函数与上下文表对客户端关闭", async () => {
    const privilege = await superuser<{ anon: boolean; helper: boolean }>(`
      select
        has_function_privilege('anon', 'public.admin_set_test_school(text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.effective_member_school_id(uuid)', 'execute') as helper
    `);
    expect(privilege).toEqual([{ anon: false, helper: false }]);
    expect(
      await asUser(ADMIN, "select * from public.admin_school_test_context"),
    ).toEqual({
      ok: false,
      error: "permission denied for table admin_school_test_context",
    });
  });

  it("普通成员伪造切换请求被拒，学校不变", async () => {
    expect(errorOf(await switchSchool(UW_STUDENT, "umich"))).toBe(DENIED);
    expect(await currentSchool(UW_STUDENT)).toBe("uw-madison");
  });

  it("只能切到已开放的学校", async () => {
    expect(errorOf(await switchSchool(ADMIN, "nowhere"))).toBe("请选择已开放的学校。");
    expect(errorOf(await switchSchool(ADMIN, "closed-u"))).toBe("请选择已开放的学校。");
    expect(await currentSchool(ADMIN)).toBe("umich");
  });

  it("切换与返回都写进操作记录；选回本校等于清除测试状态", async () => {
    expect(
      await value(ADMIN, "select public.admin_set_test_school('uw-madison')"),
    ).toBe("uw-madison");
    expect(await currentSchool(ADMIN)).toBe("uw-madison");

    const [audit] = await superuser(`
      select actor_id::text, action, target, details
      from public.admin_audit_log order by id desc limit 1
    `);
    expect(audit).toEqual({
      actor_id: ADMIN,
      action: "school.test_switch",
      target: "uw-madison",
      details: { from: "umich", to: "uw-madison", home_school: "umich" },
    });

    expect(await value(ADMIN, "select public.admin_set_test_school('umich')")).toBe("umich");
    expect(
      await superuser("select user_id from public.admin_school_test_context"),
    ).toEqual([]);
  });
});

describe("课程群只按当前学校放行", () => {
  it("测试学校里能看到课、加入、发消息，并看到同课同学", async () => {
    await switchOrThrow(ADMIN, "uw-madison");

    expect(
      await rows(ADMIN, "select code from public.courses order by code"),
    ).toEqual([{ code: "COMP SCI 400" }]);
    expect(
      (await asUser(
        ADMIN,
        `insert into public.course_members (course_id, user_id) values ('${uwCourse}', '${ADMIN}')`,
      )).ok,
    ).toBe(true);
    expect(await sendStatus(ADMIN, uwConversation, "hello uw")).toBe("sent");
    expect(
      await rows(ADMIN, `select id::text from public.profiles where id = '${UW_STUDENT}'`),
    ).toEqual([{ id: UW_STUDENT }]);
  });

  it("切回本校后，旧页面读不到也发不了 UW 课程群；选课和历史消息保留", async () => {
    await switchOrThrow(ADMIN, null);

    expect(await visibleMessages(ADMIN, uwConversation)).toBe(0);
    expect(await sendStatus(ADMIN, uwConversation, "still here?")).toBe("not_available");
    // 绕过 RPC 直接写表（相当于伪造 REST 请求）同样被 RLS 拦下
    expect(
      (await asUser(
        ADMIN,
        `insert into public.messages (conversation_id, sender_id, body)
         values ('${uwConversation}', '${ADMIN}', 'forged')`,
      )).ok,
    ).toBe(false);
    expect(
      await rows(ADMIN, `select id from public.courses where id = '${uwCourse}'`),
    ).toEqual([]);
    expect(
      await rows(ADMIN, `select id from public.profiles where id = '${UW_STUDENT}'`),
    ).toEqual([]);

    expect(
      await superuser(
        `select user_id::text from public.course_members
         where course_id = '${uwCourse}' and user_id = '${ADMIN}'`,
      ),
    ).toEqual([{ user_id: ADMIN }]);
    expect(await visibleMessages(UW_STUDENT, uwConversation)).toBe(1);
  });

  it("再次进入测试学校，原来的选课和消息恢复可见", async () => {
    await switchOrThrow(ADMIN, "uw-madison");
    expect(await visibleMessages(ADMIN, uwConversation)).toBe(1);
  });

  it("撤销管理员身份后，测试状态随之失效", async () => {
    expect(
      (await asUser(OWNER, `select public.admin_revoke_admin('${ADMIN}')`)).ok,
    ).toBe(true);

    expect(await currentSchool(ADMIN)).toBe("umich");
    expect(await visibleMessages(ADMIN, uwConversation)).toBe(0);
    expect(
      await superuser("select user_id from public.admin_school_test_context"),
    ).toEqual([]);

    // 重新任命后也不会悄悄回到测试学校
    expect(
      (await asUser(OWNER, "select public.admin_grant_admin('admin@umich.edu')")).ok,
    ).toBe(true);
    expect(await currentSchool(ADMIN)).toBe("umich");
  });

  it("关闭测试学校会清除测试状态，重新开放也不会恢复", async () => {
    await switchOrThrow(ADMIN, "uw-madison");
    expect(
      (await asUser(OWNER, "select public.admin_set_school_enabled('uw-madison', false)")).ok,
    ).toBe(true);
    expect(await currentSchool(ADMIN)).toBe("umich");

    expect(
      (await asUser(OWNER, "select public.admin_set_school_enabled('uw-madison', true)")).ok,
    ).toBe(true);
    expect(await currentSchool(ADMIN)).toBe("umich");
  });
});

describe("好友与私聊按双方当前学校检查", () => {
  let directConversation: string;
  let pendingRequest: string;

  it("测试学校里能按邮箱找到同校成员、加好友并私聊", async () => {
    await switchOrThrow(ADMIN, "uw-madison");

    expect(
      await value(ADMIN, "select result_status from public.find_member_by_email('student@wisc.edu')"),
    ).toBe("found");
    expect(
      await value(UW_STUDENT, "select result_status from public.find_member_by_email('admin@umich.edu')"),
    ).toBe("found");

    const [request] = await rows<{ result_status: string; request_id: string }>(
      ADMIN,
      `select result_status, request_id::text from public.send_friend_request('${UW_STUDENT}', 'hi')`,
    );
    expect(request.result_status).toBe("sent");

    const [accepted] = await rows<{ result_status: string; conversation_id: string }>(
      UW_STUDENT,
      `select result_status, conversation_id::text
       from public.respond_to_friend_request('${request.request_id}', 'accept')`,
    );
    expect(accepted.result_status).toBe("accepted");
    directConversation = accepted.conversation_id;

    expect(await sendStatus(ADMIN, directConversation, "from admin")).toBe("sent");
    expect(await sendStatus(UW_STUDENT, directConversation, "from student")).toBe("sent");

    // 留一条待处理的申请，下面测切校后还能不能拒绝
    const [incoming] = await rows<{ result_status: string; request_id: string }>(
      UW_OTHER,
      `select result_status, request_id::text from public.send_friend_request('${ADMIN}', 'hello')`,
    );
    expect(incoming.result_status).toBe("sent");
    pendingRequest = incoming.request_id;
  });

  it("切回本校后，私聊历史仍可读，但双方都不能再发；对方也搜不到", async () => {
    await switchOrThrow(ADMIN, null);

    expect(await visibleMessages(ADMIN, directConversation)).toBeGreaterThanOrEqual(3);
    expect(await sendStatus(ADMIN, directConversation, "after switch")).toBe("not_allowed");
    expect(await sendStatus(UW_STUDENT, directConversation, "reply")).toBe("not_allowed");
    expect(
      await value(ADMIN, `select send_status from public.get_direct_conversation_view('${directConversation}')`),
    ).toBe("readonly");

    expect(
      await value(UW_STUDENT, "select result_status from public.find_member_by_email('admin@umich.edu')"),
    ).toBe("not_found");
    expect(
      await value(ADMIN, `select result_status from public.send_friend_request('${UW_OTHER}', 'late')`),
    ).toBe("not_available");
  });

  it("切校后仍能拉黑已有联系人、拒绝待处理的申请，但不能接受", async () => {
    expect(
      await value(ADMIN, `select public.set_member_blocked('${UW_STUDENT}', true)`),
    ).toBe("saved");
    expect(
      await value(ADMIN, `select public.set_member_blocked('${UW_STUDENT}', false)`),
    ).toBe("cleared");

    expect(
      await value(
        ADMIN,
        `select result_status from public.respond_to_friend_request('${pendingRequest}', 'accept')`,
      ),
    ).toBe("not_available");
    expect(
      await value(
        ADMIN,
        `select result_status from public.respond_to_friend_request('${pendingRequest}', 'reject')`,
      ),
    ).toBe("rejected");
  });

  it("有过申请往来的外校成员可以拉黑；毫无往来的外校成员不开放", async () => {
    // UW_OTHER 曾向管理员发过申请（已被拒绝），属于已有联系
    expect(
      await value(ADMIN, `select public.set_member_blocked('${UW_OTHER}', true)`),
    ).toBe("saved");
    expect(
      await value(ADMIN, `select public.set_member_blocked('${UW_STRANGER}', true)`),
    ).toBe("not_available");
  });
});

describe("普通成员不受影响", () => {
  it("当前学校就是邮箱归属", async () => {
    expect(await currentSchool(UW_STUDENT)).toBe("uw-madison");
    expect(await currentSchool(UM_STUDENT)).toBe("umich");
  });

  it("不同学校的普通成员照旧不能加好友", async () => {
    expect(
      await value(UM_STUDENT, `select result_status from public.send_friend_request('${UW_STUDENT}', 'hi')`),
    ).toBe("not_available");
  });
});
