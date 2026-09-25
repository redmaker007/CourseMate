import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 成员会话合并读取（202609250001）。
 *
 * get_member_context 把绑定学校、域名对应的开放学校、当前学校和 onboarding 状态
 * 合成一次调用。这里逐项对照原来的四次独立读取，确认结果一致、权限没有放宽。
 * 按真实顺序跑完全部 migration，测试桩与其他集成测试一样复刻 Supabase 的
 * default privileges。
 */

const OWNER = "c1111111-1111-4111-8111-111111111111"; // wisc，所有者
const ADMIN = "c2222222-2222-4222-8222-222222222222"; // umich 邮箱，管理员
const STUDENT = "c3333333-3333-4333-8333-333333333333"; // wisc，有资料
const NO_PROFILE = "c4444444-4444-4444-8444-444444444444"; // wisc，没填资料
const AUTH_ONLY = "c5555555-5555-4555-8555-555555555555"; // 有 Auth 用户但没有成员账号

type Row = Record<string, unknown>;
type Attempt = { ok: true; rows: Row[] } | { ok: false; error: string };

let database: PGlite;

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

const context = (userId: string | null, domain: string) =>
  rows(userId, `select * from public.get_member_context('${domain}')`);

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
    -- 需要这项授权（已在真实项目上核对）。其余测试里的函数都是 security definer，用不到。
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
      ('${OWNER}', 'owner@wisc.edu', now()),
      ('${ADMIN}', 'admin@umich.edu', now()),
      ('${STUDENT}', 'student@wisc.edu', now()),
      ('${NO_PROFILE}', 'noprofile@wisc.edu', now()),
      ('${AUTH_ONLY}', 'authonly@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${OWNER}', 'Owner'),
      ('${ADMIN}', 'Admin'),
      ('${STUDENT}', 'Student');
    insert into public.platform_roles (user_id, role) values
      ('${OWNER}', 'owner'),
      ('${ADMIN}', 'admin');
    insert into public.schools (id, name_zh, name_en, enabled)
    values ('closed-u', '未开放大学', 'Closed University', false);
    insert into public.school_email_domains (domain, school_id)
    values ('closed.edu', 'closed-u');
    delete from public.member_accounts where user_id = '${AUTH_ONLY}';
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("get_member_context", () => {
  it("一次返回绑定学校、开放学校、当前学校与 onboarding 状态", async () => {
    expect(await context(STUDENT, "wisc.edu")).toEqual([
      {
        user_id: STUDENT,
        home_school_id: "uw-madison",
        enabled_school_id: "uw-madison",
        current_school_id: "uw-madison",
        onboarding_complete: true,
      },
    ]);
  });

  it("域名没有对应的开放学校时开放学校为空，但绑定仍然返回", async () => {
    const [unknown] = await context(STUDENT, "gmail.com");
    expect(unknown).toMatchObject({
      home_school_id: "uw-madison",
      enabled_school_id: null,
    });

    const [closed] = await context(STUDENT, "closed.edu");
    expect(closed).toMatchObject({ enabled_school_id: null });
  });

  it("域名大小写与首尾空格按原有规则规范化", async () => {
    const [row] = await context(STUDENT, "  WISC.EDU ");
    expect(row).toMatchObject({ enabled_school_id: "uw-madison" });
  });

  it("没有填写资料的成员 onboarding 为 false", async () => {
    const [row] = await context(NO_PROFILE, "wisc.edu");
    expect(row).toMatchObject({ user_id: NO_PROFILE, onboarding_complete: false });
  });

  it("只有 Auth 用户、没有成员账号时返回零行", async () => {
    expect(await context(AUTH_ONLY, "wisc.edu")).toEqual([]);
  });

  it("没有登录身份时返回零行，不会读到任何人的绑定", async () => {
    expect(await context(null, "wisc.edu")).toEqual([]);
  });

  it("只能读到调用者自己的成员账号，传什么域名都不能换成别人", async () => {
    const [admin] = await context(ADMIN, "wisc.edu");
    expect(admin).toMatchObject({
      user_id: ADMIN,
      home_school_id: "umich",
      // 域名由调用方传入，这里传 wisc.edu，所以开放学校是 uw-madison；
      // 调用方（服务端）负责传入已验证邮箱的域名，函数本身不判断绑定是否一致。
      enabled_school_id: "uw-madison",
    });
  });

  it("显式按 auth.uid() 过滤：即使调用者绕过 RLS，也只返回自己的成员账号", async () => {
    // service_role 带 bypassrls。这层过滤不依赖 member_accounts 的 RLS 是否开启，
    // 去掉它，绕过 RLS 的调用者会拿到所有成员的绑定。
    await database.exec(
      `set role service_role;
       select set_config('request.jwt.claim.sub', '${STUDENT}', false);`,
    );
    const result = await run("select user_id from public.get_member_context('wisc.edu')");

    expect(result).toEqual({ ok: true, rows: [{ user_id: STUDENT }] });
  });

  it("管理员跨校测试时当前学校跟随测试上下文，绑定学校保持邮箱归属", async () => {
    await asUser(ADMIN, "select public.admin_set_test_school('uw-madison')");
    const [row] = await context(ADMIN, "umich.edu");

    expect(row).toMatchObject({
      home_school_id: "umich",
      enabled_school_id: "umich",
      current_school_id: "uw-madison",
    });

    await asUser(ADMIN, "select public.admin_set_test_school(null)");
  });

  it("与原来的四次独立读取逐项一致", async () => {
    for (const [userId, domain] of [
      [STUDENT, "wisc.edu"],
      [NO_PROFILE, "wisc.edu"],
      [ADMIN, "umich.edu"],
      [OWNER, "wisc.edu"],
    ] as const) {
      const [merged] = await context(userId, domain);
      const [legacy] = await rows(
        userId,
        `select
           (select school_id from public.member_accounts where user_id = auth.uid()) as home,
           public.enabled_school_id_for_email_domain('${domain}') as enabled,
           public.current_school_id() as current,
           public.has_completed_onboarding() as onboarding`,
      );

      expect({
        home: merged.home_school_id,
        enabled: merged.enabled_school_id,
        current: merged.current_school_id,
        onboarding: merged.onboarding_complete,
      }).toEqual(legacy);
    }
  });
});

describe("get_member_context 的权限", () => {
  it("只授予已登录用户，未登录与 PUBLIC 都不能执行", async () => {
    const [privilege] = (
      await database.query(`
        select
          has_function_privilege('anon', 'public.get_member_context(text)', 'execute') as anon,
          has_function_privilege('authenticated', 'public.get_member_context(text)', 'execute') as authenticated,
          exists (
            select 1
            from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where p.oid = 'public.get_member_context(text)'::regprocedure
              and acl.grantee = 0
              and acl.privilege_type = 'EXECUTE'
          ) as public_execute
      `)
    ).rows;

    expect(privilege).toEqual({ anon: false, authenticated: true, public_execute: false });
  });

  it("未登录角色直接调用被拒绝", async () => {
    await database.exec("set role anon;");
    const denied = await run("select * from public.get_member_context('wisc.edu')");
    expect(denied).toEqual({
      ok: false,
      error: "permission denied for function get_member_context",
    });
  });

  it("以调用者身份执行，而不是函数属主", async () => {
    const [meta] = (
      await database.query(`
        select prosecdef as security_definer, provolatile as volatility
        from pg_proc where oid = 'public.get_member_context(text)'::regprocedure
      `)
    ).rows;

    expect(meta).toEqual({ security_definer: false, volatility: "s" });
  });
});
