// 验证 supabase/templates/course-catalog-import.sql 这份直连兜底导入模板：
// 只对已存在的 course_catalog 做数据写入，不建表、不改权限/RLS，边界字符和
// 重复课号都能正确落库，重复执行是幂等的。
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite;
let templateSql: string;

const VALUES_BLOCK = /-- ### 在此替换成实际数据[\s\S]*?-- ### 替换结束 ### -+/;

// 覆盖：Unicode、多行简介、撇号转义、可选字段为 null、多单词学科缩写、以及
// 同一批次内规范化后撞车的课号（course_catalog / EECS I S 与 course_catalog/
// EECSIS 应该被判成同一门课）。
const SYNTHETIC_ROWS = `
    ('uw-madison', 'EECS I S 501', 'EECS I S', '501',
     '数据系统导论 Intro to Data Systems', '3-4', 'EECS',
     'Fall, Spring',
     E'MATH 234 or equivalent\\nGraduate standing recommended',
     E'Covers query processing, storage engines, and O''Brien''s\\nconsistency model across multiple lectures.',
     '00700731', 'Fall 2026'),
    ('uw-madison', 'eecsis501', 'EECS I S', '501',
     'Duplicate-coded row that should collapse into one', null, null,
     null, null, null, null, null),
    ('uw-madison', 'PHIL OF SCI 620', 'PHIL OF SCI', '620',
     'Philosophy of Science Seminar', '3', null, null, null, null,
     null, null)
`;

function withSyntheticValues(sql: string): string {
  const replaced = sql.replace(VALUES_BLOCK, SYNTHETIC_ROWS.trim());
  if (replaced === sql) {
    throw new Error("未能在模板里定位到 VALUES 占位块，模板格式可能变了");
  }
  return replaced;
}

async function catalogAclSnapshot() {
  const [rls, policies, grants] = await Promise.all([
    database.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'course_catalog'`,
    ),
    database.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'course_catalog'
       order by policyname`,
    ),
    database.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.table_privileges
       where table_schema = 'public' and table_name = 'course_catalog'
       order by grantee, privilege_type`,
    ),
  ]);
  return {
    rls: rls.rows[0]?.relrowsecurity,
    policies: policies.rows.map((row) => row.policyname),
    grants: grants.rows,
  };
}

async function publicTableCount() {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`,
  );
  return result.rows[0].count;
}

beforeAll(async () => {
  templateSql = await readFile(
    resolve(process.cwd(), "supabase/templates/course-catalog-import.sql"),
    "utf8",
  );

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
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);

  const migrations = (
    await readdir(resolve(process.cwd(), "supabase/migrations"))
  )
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) {
    await database.exec(
      await readFile(
        resolve(process.cwd(), "supabase/migrations", migration),
        "utf8",
      ),
    );
  }
});

afterAll(async () => {
  await database?.close();
});

describe("course-catalog-import.sql 模板", () => {
  it("只写数据：不建表、不改 course_catalog 的 RLS/策略/权限", async () => {
    const beforeTables = await publicTableCount();
    const beforeAcl = await catalogAclSnapshot();

    await database.exec(withSyntheticValues(templateSql));

    const afterTables = await publicTableCount();
    const afterAcl = await catalogAclSnapshot();

    expect(afterTables).toBe(beforeTables);
    expect(afterAcl).toEqual(beforeAcl);
    // 直接回应本次要诊断的那条 Studio 假警告：模板执行后不存在名为 the 的表。
    const phantomTable = await database.query(
      `select to_regclass('public.the') as name`,
    );
    expect(phantomTable.rows[0]).toEqual({ name: null });
  });

  it("边界字符正确落库，批内重复课号被去重成一条", async () => {
    const rows = await database.query<{
      code: string;
      code_normalized: string;
      title: string;
      requisites: string | null;
      description: string | null;
      source_course_id: string | null;
    }>(
      `select code, code_normalized, title, requisites, description,
              source_course_id
       from public.course_catalog
       where school_id = 'uw-madison' and code_normalized = 'EECSIS501'`,
    );
    // 两行规范化后撞同一个 code_normalized，应该只剩一条。
    expect(rows.rows).toHaveLength(1);

    const survivor = rows.rows[0];
    expect(survivor.code_normalized).toBe("EECSIS501");
    // 撇号与多行文本原样保留，没有被转义序列或截断破坏。
    expect(survivor.description).toContain("O'Brien's");
    expect(survivor.description).toContain("\n");
    expect(survivor.requisites).toContain("\n");
    // 学校原文的字符串形式课号保留前导零，没有被当数字处理。
    expect(survivor.source_course_id).toBe("00700731");

    const multiwordSubject = await database.query<{
      subject: string;
      code_normalized: string;
    }>(
      `select subject, code_normalized from public.course_catalog
       where school_id = 'uw-madison' and code = 'PHIL OF SCI 620'`,
    );
    expect(multiwordSubject.rows).toEqual([
      { subject: "PHIL OF SCI", code_normalized: "PHILOFSCI620" },
    ]);

    const unicodeTitle = await database.query<{ title: string }>(
      `select title from public.course_catalog
       where school_id = 'uw-madison' and code_normalized = 'EECSIS501'`,
    );
    expect(unicodeTitle.rows[0].title).toContain("数据系统导论");
  });

  it("物化成功，且和 ON CONFLICT 一样对重复执行幂等", async () => {
    const firstMaterialize = await database.query<{
      materialized_term: string;
      created_count: number;
      existing_count: number;
      invalid_count: number;
    }>(`select * from public.materialize_catalog_courses('uw-madison')`);
    expect(firstMaterialize.rows[0].invalid_count).toBe(0);

    const beforeRetryCount = await database.query<{ count: number }>(
      `select count(*)::int as count from public.course_catalog
       where school_id = 'uw-madison'
         and code_normalized in ('EECSIS501', 'PHILOFSCI620')`,
    );

    // 重新执行同一份模板（相同数据）：ON CONFLICT DO UPDATE 应该原地更新，
    // 不产生新行，也不报错。
    await database.exec(withSyntheticValues(templateSql));

    const afterRetryCount = await database.query<{ count: number }>(
      `select count(*)::int as count from public.course_catalog
       where school_id = 'uw-madison'
         and code_normalized in ('EECSIS501', 'PHILOFSCI620')`,
    );
    expect(afterRetryCount.rows[0].count).toBe(beforeRetryCount.rows[0].count);

    const secondMaterialize = await database.query<{
      created_count: number;
      existing_count: number;
      invalid_count: number;
    }>(`select * from public.materialize_catalog_courses('uw-madison')`);
    // 第二次物化：这两门课已经物化过，不应该再新建。
    expect(secondMaterialize.rows[0].created_count).toBe(0);
    expect(secondMaterialize.rows[0].invalid_count).toBe(0);
  });
});
