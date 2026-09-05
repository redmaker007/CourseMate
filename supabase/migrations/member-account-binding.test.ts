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
  `);

  for (const migrationName of [
    "202609050001_email_otp_request.sql",
    "202609050002_member_account_binding.sql",
  ]) {
    const migration = await readFile(
      resolve(process.cwd(), "supabase/migrations", migrationName),
      "utf8",
    );
    await database.exec(migration);
  }
});

afterAll(async () => {
  await database.close();
});

describe("Member Account 自动绑定 migration", () => {
  it("邮箱首次确认时自动创建学校绑定且不需要 Profile", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    await database.exec(`
      insert into auth.users (id, email)
      values ('${userId}', 'Student@WISC.EDU');
      update auth.users
      set email_confirmed_at = now()
      where id = '${userId}';
    `);

    const result = await database.query<{
      school_id: string;
      user_id: string;
    }>(`
      select user_id::text, school_id
      from public.member_accounts
      where user_id = '${userId}'
    `);

    expect(result.rows).toEqual([
      { school_id: "uw-madison", user_id: userId },
    ]);
  });

  it("重复触发时幂等地保留同一条绑定", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    await database.exec(`
      insert into auth.users (id, email, email_confirmed_at)
      values ('${userId}', 'student@wisc.edu', now());
      update auth.users
      set email_confirmed_at = email_confirmed_at + interval '1 second'
      where id = '${userId}';
    `);

    const result = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.member_accounts
      where user_id = '${userId}'
    `);

    expect(result.rows).toEqual([{ count: 1 }]);
  });

  it("邮箱没有开放学校时确认失败并回滚 Auth 更新", async () => {
    const userId = "55555555-5555-4555-8555-555555555555";
    await database.exec(`
      insert into auth.users (id, email)
      values ('${userId}', 'student@example.com')
    `);

    await expect(
      database.exec(`
        update auth.users
        set email_confirmed_at = now()
        where id = '${userId}'
      `),
    ).rejects.toThrow();

    const authUser = await database.query<{
      email_confirmed_at: string | null;
    }>(`
      select email_confirmed_at::text
      from auth.users
      where id = '${userId}'
    `);
    const member = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.member_accounts
      where user_id = '${userId}'
    `);

    expect(authUser.rows).toEqual([{ email_confirmed_at: null }]);
    expect(member.rows).toEqual([{ count: 0 }]);
  });

  it("已有冲突学校绑定时确认失败且不覆盖原绑定", async () => {
    const userId = "66666666-6666-4666-8666-666666666666";
    await database.exec(`
      insert into public.schools (id, name_zh, name_en, enabled)
      values ('other-school', '其他学校', 'Other School', true);
      insert into public.school_email_domains (domain, school_id)
      values ('other.edu', 'other-school');
      insert into auth.users (id, email)
      values ('${userId}', 'conflict@wisc.edu');
      insert into public.member_accounts (user_id, school_id)
      values ('${userId}', 'other-school');
    `);

    await expect(
      database.exec(`
        update auth.users
        set email_confirmed_at = now()
        where id = '${userId}'
      `),
    ).rejects.toThrow();

    const result = await database.query<{ school_id: string }>(`
      select school_id
      from public.member_accounts
      where user_id = '${userId}'
    `);
    expect(result.rows).toEqual([{ school_id: "other-school" }]);
  });

  it("数据库拒绝修改 Auth 登录邮箱", async () => {
    const userId = "77777777-7777-4777-8777-777777777777";
    await database.exec(`
      insert into auth.users (id, email, email_confirmed_at)
      values ('${userId}', 'original@wisc.edu', now())
    `);

    await expect(
      database.exec(`
        update auth.users
        set email = 'changed@wisc.edu'
        where id = '${userId}'
      `),
    ).rejects.toThrow();

    const result = await database.query<{ email: string }>(`
      select email from auth.users where id = '${userId}'
    `);
    expect(result.rows).toEqual([{ email: "original@wisc.edu" }]);
  });
});
