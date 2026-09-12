import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 平台角色与管理函数（202609100006）。
 *
 * 按真实顺序跑完全部 migration：管理函数会调用课程目录的物化、会触发课程流程的
 * 学期归档，只跑到自己那一步证明不了它们叠在一起还能工作。测试桩与
 * course-catalog-integration.test.ts 一样，复刻了 Supabase 对新表与新函数的
 * default privileges。
 */

const OWNER = "a1111111-1111-4111-8111-111111111111"; // wisc，所有者
const ADMIN = "a2222222-2222-4222-8222-222222222222"; // umich，管理员
const MEMBER = "a3333333-3333-4333-8333-333333333333"; // wisc，普通成员
const CANDIDATE = "a4444444-4444-4444-8444-444444444444"; // wisc，用来测任命与撤销

const DENIED = "没有权限执行这个管理操作";

/** 所有对客户端开放的函数。未登录用户一个都不能执行。 */
const CLIENT_FUNCTIONS = [
  "public.current_platform_role()",
  "public.admin_list_schools()",
  "public.admin_list_staff()",
  "public.admin_list_audit_log(integer)",
  "public.admin_grant_admin(text)",
  "public.admin_revoke_admin(uuid)",
  "public.admin_save_school(text, text, text)",
  "public.admin_set_school_enabled(text, boolean)",
  "public.admin_add_school_domain(text, text)",
  "public.admin_remove_school_domain(text)",
  "public.admin_set_current_term(text, text)",
  "public.admin_import_catalog_batch(text, jsonb)",
  "public.admin_materialize_catalog(text)",
  "public.admin_save_catalog_course(text, text, text)",
];

type Attempt =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

let database: PGlite;

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

async function asAnon(sql: string): Promise<Attempt> {
  await database.exec(
    `select set_config('request.jwt.claim.sub', '', false);
     set role anon;`,
  );
  return run(sql);
}

async function rows<T>(userId: string, sql: string): Promise<T[]> {
  const result = await asUser(userId, sql);
  if (!result.ok) throw new Error(result.error);
  return result.rows as T[];
}

function errorOf(attempt: Attempt): string | null {
  return attempt.ok ? null : attempt.error;
}

async function canExecute(role: string, signature: string) {
  const result = await database.query<{ allowed: boolean }>(
    `select has_function_privilege('${role}', '${signature}', 'execute') as allowed`,
  );
  return result.rows[0].allowed;
}

async function latestAudit() {
  const result = await database.query(
    `select actor_id::text, action, target, details
     from public.admin_audit_log order by id desc limit 1`,
  );
  return result.rows[0];
}

async function admittedSchool(domain: string) {
  const result = await database.query<{ school: string | null }>(
    `select public.enabled_school_id_for_email_domain('${domain}') as school`,
  );
  return result.rows[0].school;
}

async function conversationArchivedAt(school: string, code: string, term: string) {
  const result = await database.query<{ archived_at: string | null }>(
    `select conversations.archived_at
     from public.courses courses
     join public.course_conversations links on links.course_id = courses.id
     join public.conversations conversations on conversations.id = links.conversation_id
     where courses.school_id = '${school}' and courses.code = '${code}'
       and courses.term = '${term}'`,
  );
  return result.rows;
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

  // 后续社交功能的权限与函数变更也必须通过既有管理功能回归。
  const migrations = (await readdir(resolve(process.cwd(), "supabase/migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) {
    await database.exec(
      await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"),
    );
  }

  // 第一位 owner 与 admin 由 SQL Editor 手工指定，这里同样以超级用户身份写入
  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'owner@wisc.edu', now()),
      ('${ADMIN}', 'admin@umich.edu', now()),
      ('${MEMBER}', 'member@wisc.edu', now()),
      ('${CANDIDATE}', 'candidate@wisc.edu', now());
    insert into public.profiles (id, display_name) values
      ('${OWNER}', 'Owner'),
      ('${ADMIN}', 'Admin'),
      ('${MEMBER}', 'Member'),
      ('${CANDIDATE}', 'Candidate');
    insert into public.platform_roles (user_id, role) values
      ('${OWNER}', 'owner'),
      ('${ADMIN}', 'admin');
  `);
});

afterAll(async () => {
  await database?.close();
});

describe("身份与权限边界", () => {
  it("未登录用户执行不了任何管理函数，也读不到角色表和操作记录", async () => {
    for (const signature of CLIENT_FUNCTIONS) {
      expect(await canExecute("anon", signature), signature).toBe(false);
    }
    expect(await asAnon("select * from public.platform_roles")).toEqual({
      ok: false,
      error: "permission denied for table platform_roles",
    });
    expect(await asAnon("select * from public.admin_audit_log")).toEqual({
      ok: false,
      error: "permission denied for table admin_audit_log",
    });
  });

  it("内部辅助函数对登录用户也不开放", async () => {
    expect(
      await canExecute("authenticated", "public.require_platform_role(text)"),
    ).toBe(false);
    expect(
      await canExecute(
        "authenticated",
        "public.write_admin_audit(uuid, text, text, jsonb)",
      ),
    ).toBe(false);
  });

  it("普通成员：身份为空，管理函数一律拒绝，角色表读写不了", async () => {
    expect(
      await asUser(MEMBER, "select public.current_platform_role() as role"),
    ).toEqual({ ok: true, rows: [{ role: null }] });
    expect(
      errorOf(await asUser(MEMBER, "select * from public.admin_list_schools()")),
    ).toBe(DENIED);
    expect(
      errorOf(await asUser(MEMBER, "select * from public.admin_list_audit_log(10)")),
    ).toBe(DENIED);
    expect(
      await asUser(
        MEMBER,
        `insert into public.platform_roles (user_id, role) values ('${MEMBER}', 'owner')`,
      ),
    ).toEqual({ ok: false, error: "permission denied for table platform_roles" });
  });

  it("管理员与所有者各自读到自己的身份", async () => {
    expect(
      await asUser(ADMIN, "select public.current_platform_role() as role"),
    ).toEqual({ ok: true, rows: [{ role: "admin" }] });
    expect(
      await asUser(OWNER, "select public.current_platform_role() as role"),
    ).toEqual({ ok: true, rows: [{ role: "owner" }] });
  });

  it("只能有一位所有者", async () => {
    await expect(
      database.query(
        `insert into public.platform_roles (user_id, role) values ('${MEMBER}', 'owner')`,
      ),
    ).rejects.toThrow(/platform_roles_single_owner/);
  });
});

describe("任命与撤销管理员", () => {
  it("所有者按邮箱任命，不区分大小写，并记下操作人", async () => {
    expect(
      (await asUser(OWNER, "select public.admin_grant_admin(' Candidate@WISC.edu ')")).ok,
    ).toBe(true);
    expect(
      await asUser(CANDIDATE, "select public.current_platform_role() as role"),
    ).toEqual({ ok: true, rows: [{ role: "admin" }] });
    expect(await latestAudit()).toMatchObject({
      actor_id: OWNER,
      action: "staff.grant_admin",
      target: CANDIDATE,
    });
  });

  it("找不到成员、或对方已有身份时，给出能直接看懂的提示", async () => {
    expect(
      errorOf(await asUser(OWNER, "select public.admin_grant_admin('nobody@wisc.edu')")),
    ).toMatch(/找不到这个邮箱对应的成员/);
    expect(
      errorOf(await asUser(OWNER, "select public.admin_grant_admin('admin@umich.edu')")),
    ).toBe("这位成员已经是管理员。");
    expect(
      errorOf(await asUser(OWNER, "select public.admin_grant_admin('owner@wisc.edu')")),
    ).toBe("这位成员已经是所有者。");
  });

  it("管理员不能任命或撤销别人", async () => {
    expect(
      errorOf(await asUser(ADMIN, "select public.admin_grant_admin('member@wisc.edu')")),
    ).toBe(DENIED);
    expect(
      errorOf(await asUser(ADMIN, `select public.admin_revoke_admin('${CANDIDATE}')`)),
    ).toBe(DENIED);
  });

  it("撤销后立即失去权限；所有者本人经网站撤不掉", async () => {
    expect(
      (await asUser(OWNER, `select public.admin_revoke_admin('${CANDIDATE}')`)).ok,
    ).toBe(true);
    expect(
      errorOf(await asUser(CANDIDATE, "select * from public.admin_list_schools()")),
    ).toBe(DENIED);
    expect(
      errorOf(await asUser(OWNER, `select public.admin_revoke_admin('${OWNER}')`)),
    ).toBe("这位成员不是管理员。");
  });

  it("管理员看得到团队名单，所有者排在最前", async () => {
    expect(
      await asUser(ADMIN, "select email, role from public.admin_list_staff()"),
    ).toEqual({
      ok: true,
      rows: [
        { email: "owner@wisc.edu", role: "owner" },
        { email: "admin@umich.edu", role: "admin" },
      ],
    });
  });
});

describe("学校与邮箱域名", () => {
  it("管理员只能查看学校，不能修改", async () => {
    expect(
      await rows(
        ADMIN,
        `select school_id, enabled, domains, current_term
         from public.admin_list_schools() where school_id = 'uw-madison'`,
      ),
    ).toEqual([
      {
        school_id: "uw-madison",
        enabled: true,
        domains: ["wisc.edu"],
        current_term: "2026-fall",
      },
    ]);

    for (const sql of [
      "select public.admin_save_school('x-u', '某大学', 'X University')",
      "select public.admin_set_school_enabled('umich', false)",
      "select public.admin_add_school_domain('umich', 'med.umich.edu')",
      "select public.admin_remove_school_domain('umich.edu')",
    ]) {
      expect(errorOf(await asUser(ADMIN, sql)), sql).toBe(DENIED);
    }
  });

  it("新学校默认不开放；没有域名开放不了；开放后登录准入立即生效", async () => {
    expect(
      (await asUser(OWNER, "select public.admin_save_school(' Test-U ', '测试大学', 'Test University')")).ok,
    ).toBe(true);
    expect(
      await rows(
        OWNER,
        `select enabled, domains, current_term
         from public.admin_list_schools() where school_id = 'test-u'`,
      ),
    ).toEqual([{ enabled: false, domains: [], current_term: null }]);

    expect(
      errorOf(await asUser(OWNER, "select public.admin_set_school_enabled('test-u', true)")),
    ).toMatch(/请先为这所学校添加至少一个邮箱域名/);

    expect(
      (await asUser(OWNER, "select public.admin_add_school_domain('test-u', ' @Test.EDU ')")).ok,
    ).toBe(true);
    expect(await admittedSchool("test.edu")).toBeNull();

    expect(
      (await asUser(OWNER, "select public.admin_set_school_enabled('test-u', true)")).ok,
    ).toBe(true);
    expect(await admittedSchool("test.edu")).toBe("test-u");
  });

  it("域名格式不对、已在本校、属于别的学校时，给出提示", async () => {
    expect(
      errorOf(await asUser(OWNER, "select public.admin_add_school_domain('test-u', 'not a domain')")),
    ).toMatch(/域名格式不对/);
    expect(
      errorOf(await asUser(OWNER, "select public.admin_add_school_domain('test-u', 'test.edu')")),
    ).toBe("这个域名已经在这所学校名下。");
    expect(
      errorOf(await asUser(OWNER, "select public.admin_add_school_domain('test-u', 'wisc.edu')")),
    ).toBe("这个域名已经属于另一所学校（uw-madison）。");
  });

  it("开放中的学校删不掉最后一个域名；关闭后可以，登录准入随之撤销", async () => {
    expect(
      errorOf(await asUser(OWNER, "select public.admin_remove_school_domain('test.edu')")),
    ).toMatch(/最后一个域名/);

    expect(
      (await asUser(OWNER, "select public.admin_set_school_enabled('test-u', false)")).ok,
    ).toBe(true);
    expect(await admittedSchool("test.edu")).toBeNull();
    expect(
      (await asUser(OWNER, "select public.admin_remove_school_domain('test.edu')")).ok,
    ).toBe(true);
  });

  it("学校 ID 与名称的格式校验", async () => {
    expect(
      errorOf(await asUser(OWNER, "select public.admin_save_school('Bad ID', '坏', 'Bad')")),
    ).toMatch(/学校 ID 只能用小写字母/);
    expect(
      errorOf(await asUser(OWNER, "select public.admin_save_school('ok-u', '', 'Ok')")),
    ).toBe("请填写学校的中文名和英文名。");
  });

  it("每一步都记进操作记录", async () => {
    const result = await database.query<{ action: string }>(
      `select action from public.admin_audit_log where target = 'test-u' order by id`,
    );
    expect(result.rows.map((row) => row.action)).toEqual([
      "school.create",
      "school.add_domain",
      "school.enable",
      "school.disable",
      "school.remove_domain",
    ]);
  });
});

describe("学期切换", () => {
  it("格式不对、或学期没变时拒绝", async () => {
    expect(
      errorOf(await asUser(ADMIN, "select * from public.admin_set_current_term('uw-madison', 'Fall 2027')")),
    ).toMatch(/学期格式应为/);
    expect(
      errorOf(await asUser(ADMIN, "select * from public.admin_set_current_term('uw-madison', '2026-fall')")),
    ).toBe("当前学期已经是 2026-fall。");
  });

  it("切换后旧学期的课程会话归档，目录物化进新学期，并记下前后学期", async () => {
    await database.exec(`
      insert into public.course_catalog (school_id, code, subject, number, title)
      values ('uw-madison', 'ACCT I S 100', 'ACCT I S', '100', 'Introductory Accounting');
    `);
    expect(
      await rows(ADMIN, "select * from public.admin_materialize_catalog('uw-madison')"),
    ).toEqual([
      { materialized_term: "2026-fall", created_count: 1, existing_count: 0, invalid_count: 0 },
    ]);

    expect(
      await rows(ADMIN, "select * from public.admin_set_current_term('uw-madison', ' 2027-Spring ')"),
    ).toEqual([
      { materialized_term: "2027-spring", created_count: 1, existing_count: 0, invalid_count: 0 },
    ]);

    const [oldConversation] = await conversationArchivedAt("uw-madison", "ACCT I S 100", "2026-fall");
    const [newConversation] = await conversationArchivedAt("uw-madison", "ACCT I S 100", "2027-spring");
    expect(oldConversation.archived_at).not.toBeNull();
    expect(newConversation.archived_at).toBeNull();

    expect(await latestAudit()).toMatchObject({
      actor_id: ADMIN,
      action: "term.switch",
      target: "uw-madison",
      details: { from: "2026-fall", to: "2027-spring" },
    });
  });

  it("普通成员切换不了学期", async () => {
    expect(
      errorOf(await asUser(MEMBER, "select * from public.admin_set_current_term('uw-madison', '2027-fall')")),
    ).toBe(DENIED);
  });
});

describe("课程录入", () => {
  type Entry = Record<string, string>;

  const entry = (code: string, title: string): Entry => {
    const [subject, number] = code.split(" ");
    return { code, subject, number, title };
  };

  const importBatch = (school: string, entries: Entry[]) =>
    `select public.admin_import_catalog_batch('${school}', $json$${JSON.stringify(entries)}$json$::jsonb) as written`;

  async function catalogTitle(school: string, code: string) {
    const result = await database.query<{ title: string }>(
      `select title from public.course_catalog
       where school_id = '${school}' and code = '${code}'`,
    );
    return result.rows[0]?.title;
  }

  it("批量写进目录；批内重复只留第一条；再次导入改为更新", async () => {
    expect(
      await rows(ADMIN, importBatch("umich", [
        entry("EECS 280", "Programming and Data Structures"),
        entry("EECS 281", "Data Structures and Algorithms"),
        { ...entry("EECS 280", "Duplicate"), code: "eecs-280" },
      ])),
    ).toEqual([{ written: 2 }]);
    expect(await catalogTitle("umich", "EECS 280")).toBe("Programming and Data Structures");

    expect(
      await rows(ADMIN, importBatch("umich", [entry("EECS 280", "Programming & Data Structures")])),
    ).toEqual([{ written: 1 }]);
    expect(await catalogTitle("umich", "EECS 280")).toBe("Programming & Data Structures");
  });

  it("有不合格的行时整批不写，并指出是哪一门", async () => {
    expect(
      errorOf(await asUser(ADMIN, importBatch("umich", [
        entry("EECS 482", "Operating Systems"),
        entry("EECS 999", ""),
      ]))),
    ).toBe("这批数据里有不合格的课（EECS 999），整批没有写入。");
    expect(await catalogTitle("umich", "EECS 482")).toBeUndefined();
  });

  it("每批最多 500 门；学校不存在时拒绝", async () => {
    expect(
      errorOf(await asUser(ADMIN, `
        select public.admin_import_catalog_batch('umich', (
          select jsonb_agg(jsonb_build_object(
            'code', 'BULK ' || g, 'subject', 'BULK', 'number', g::text, 'title', 'Bulk'
          ))
          from generate_series(1, 501) g
        ))
      `)),
    ).toBe("每批最多 500 门课。");
    expect(
      errorOf(await asUser(ADMIN, importBatch("nowhere", [entry("EECS 280", "X")]))),
    ).toBe("找不到这所学校。");
  });

  it("物化把目录建成当前学期的课程；学校没设学期时给出提示", async () => {
    expect(
      await rows(ADMIN, "select * from public.admin_materialize_catalog('umich')"),
    ).toEqual([
      { materialized_term: "2026-fall", created_count: 2, existing_count: 0, invalid_count: 0 },
    ]);

    await database.exec(`
      insert into public.schools (id, name_zh, name_en, enabled)
      values ('no-term-u', '没学期大学', 'No Term University', false);
    `);
    expect(
      errorOf(await asUser(ADMIN, "select * from public.admin_materialize_catalog('no-term-u')")),
    ).toBe("这所学校还没有设置当前学期，请先设置。");
  });

  it("单门课：新课进目录并建出当前学期课程和会话；再次保存会同步改名", async () => {
    expect(
      await rows(ADMIN, "select public.admin_save_catalog_course('umich', ' eecs  370 ', 'Intro to Computer Organization') as outcome"),
    ).toEqual([{ outcome: "created" }]);

    const catalog = await database.query(
      `select code, subject, number, title from public.course_catalog
       where school_id = 'umich' and code_normalized = 'EECS370'`,
    );
    expect(catalog.rows).toEqual([
      { code: "EECS 370", subject: "EECS", number: "370", title: "Intro to Computer Organization" },
    ]);
    expect(await conversationArchivedAt("umich", "EECS 370", "2026-fall")).toEqual([
      { archived_at: null },
    ]);

    expect(
      await rows(ADMIN, "select public.admin_save_catalog_course('umich', 'EECS 370', 'Computer Organization') as outcome"),
    ).toEqual([{ outcome: "updated" }]);
    const course = await database.query(
      `select title from public.courses
       where school_id = 'umich' and code = 'EECS 370' and term = '2026-fall'`,
    );
    expect(course.rows).toEqual([{ title: "Computer Organization" }]);
    expect(await catalogTitle("umich", "EECS 370")).toBe("Computer Organization");
  });

  it("课号格式不对时提示；太长进不了课程表的只进目录", async () => {
    expect(
      errorOf(await asUser(ADMIN, "select public.admin_save_catalog_course('umich', 'EECS', 'No Number')")),
    ).toMatch(/课号格式应为/);
    expect(
      await rows(ADMIN, "select public.admin_save_catalog_course('umich', 'VERYLONGSUBJECTNAME 100', 'Long Code') as outcome"),
    ).toEqual([{ outcome: "catalog_only" }]);
  });

  it("普通成员调不动任何录入函数", async () => {
    for (const sql of [
      importBatch("umich", [entry("EECS 490", "Programming Languages")]),
      "select * from public.admin_materialize_catalog('umich')",
      "select public.admin_save_catalog_course('umich', 'EECS 490', 'Programming Languages')",
    ]) {
      expect(errorOf(await asUser(MEMBER, sql)), sql).toBe(DENIED);
    }
  });
});

describe("操作记录", () => {
  it("管理员看得到最近的操作，新的在前，带操作人", async () => {
    const entries = await rows<{ id: number; actor_email: string; action: string }>(
      ADMIN,
      "select id::integer as id, actor_email, action from public.admin_list_audit_log(3)",
    );
    expect(entries).toHaveLength(3);
    expect(entries[0].id).toBeGreaterThan(entries[1].id);
    expect(entries[0]).toMatchObject({
      actor_email: "admin@umich.edu",
      action: "catalog.save_course",
    });
  });
});
