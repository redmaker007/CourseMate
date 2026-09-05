import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);

  const migration = await readFile(
    resolve(
      process.cwd(),
      "supabase/migrations/202609050001_email_otp_request.sql",
    ),
    "utf8",
  );
  await database.exec(migration);
});

afterAll(async () => {
  await database.close();
});

describe("学校邮箱 OTP 请求 migration", () => {
  it("只把精确 wisc.edu 解析为开放学校", async () => {
    const exact = await database.query<{ school_id: string | null }>(
      "select public.enabled_school_id_for_email_domain('WISC.EDU') as school_id",
    );
    const subdomain = await database.query<{ school_id: string | null }>(
      "select public.enabled_school_id_for_email_domain('cs.wisc.edu') as school_id",
    );

    expect(exact.rows).toEqual([{ school_id: "uw-madison" }]);
    expect(subdomain.rows).toEqual([{ school_id: null }]);
  });

  it("Before User Created Hook 使用相同规则拒绝未配置域名", async () => {
    const allowed = await database.query<{ result: Record<string, unknown> }>(`
      select public.hook_restrict_user_to_enabled_school(
        '{"user":{"email":"student@wisc.edu"}}'::jsonb
      ) as result
    `);
    const rejected = await database.query<{ result: Record<string, unknown> }>(`
      select public.hook_restrict_user_to_enabled_school(
        '{"user":{"email":"student@cs.wisc.edu"}}'::jsonb
      ) as result
    `);

    expect(allowed.rows[0]?.result).toEqual({});
    expect(rejected.rows[0]?.result).toEqual({
      error: {
        http_code: 403,
        message: "Email is not eligible for an enabled school.",
      },
    });
  });

  it("只有 Supabase Auth 管理角色可以执行创建用户 Hook", async () => {
    await database.exec("set role supabase_auth_admin");
    try {
      await expect(
        database.query(`
          select public.hook_restrict_user_to_enabled_school(
            '{"user":{"email":"student@wisc.edu"}}'::jsonb
          )
        `),
      ).resolves.toBeDefined();
    } finally {
      await database.exec("reset role");
    }

    await database.exec("set role anon");
    try {
      await expect(
        database.query(`
          select public.hook_restrict_user_to_enabled_school(
            '{"user":{"email":"student@wisc.edu"}}'::jsonb
          )
        `),
      ).rejects.toThrow();
    } finally {
      await database.exec("reset role");
    }
  });

  it("匿名用户只能读取开放学校及其域名且不能写入", async () => {
    await database.exec(`
      insert into public.schools (id, name_zh, name_en, enabled)
      values ('disabled-school', '停用学校', 'Disabled School', false);
      insert into public.school_email_domains (domain, school_id)
      values ('disabled.edu', 'disabled-school');
      set role anon;
    `);

    try {
      const schools = await database.query<{ id: string }>(
        "select id from public.schools order by id",
      );
      const domains = await database.query<{ domain: string }>(
        "select domain from public.school_email_domains order by domain",
      );

      expect(schools.rows).toEqual([{ id: "uw-madison" }]);
      expect(domains.rows).toEqual([{ domain: "wisc.edu" }]);
      await expect(
        database.exec(`
          insert into public.schools (id, name_zh, name_en, enabled)
          values ('forbidden', '禁止', 'Forbidden', true)
        `),
      ).rejects.toThrow();
    } finally {
      await database.exec("reset role");
    }
  });

  it("已登录成员只能读取自己的学校绑定且不能写入", async () => {
    const firstUser = "11111111-1111-4111-8111-111111111111";
    const secondUser = "22222222-2222-4222-8222-222222222222";
    await database.exec(`
      insert into auth.users (id, email) values
        ('${firstUser}', 'first@wisc.edu'),
        ('${secondUser}', 'second@wisc.edu');
      insert into public.member_accounts (user_id, school_id) values
        ('${firstUser}', 'uw-madison'),
        ('${secondUser}', 'uw-madison');
      select set_config('request.jwt.claim.sub', '${firstUser}', false);
      set role authenticated;
    `);

    try {
      const accounts = await database.query<{ user_id: string }>(
        "select user_id::text from public.member_accounts order by user_id",
      );

      expect(accounts.rows).toEqual([{ user_id: firstUser }]);
      await expect(
        database.exec(`
          update public.member_accounts
          set school_id = 'uw-madison'
          where user_id = '${firstUser}'
        `),
      ).rejects.toThrow();
    } finally {
      await database.exec("reset role");
    }
  });
});
