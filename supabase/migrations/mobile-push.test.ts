import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const A = "a1111111-1111-4111-8111-111111111111", B = "b2222222-2222-4222-8222-222222222222";
const SESSION = "11111111-1111-4111-8111-111111111111", DEVICE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "ab".repeat(32);
let db: PGlite;
async function user(id: string, sql: string, session = SESSION) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);
    select set_config('request.jwt.claims','{"sub":"${id}","session_id":"${session}"}',false);`);
  try { return (await db.query(sql)).rows as Record<string, unknown>[]; } finally { await db.exec("reset role"); }
}
async function service(sql: string) {
  await db.exec("set role service_role");
  try { return (await db.query(sql)).rows as Record<string, unknown>[]; } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role supabase_auth_admin nologin bypassrls; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create publication supabase_realtime; grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const file of (await readdir(resolve("supabase/migrations"))).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
    await db.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
  }
});
beforeEach(async () => {
  await db.exec(`truncate auth.users cascade;
    insert into auth.users values ('${A}','alice@wisc.edu',now()),('${B}','bob@wisc.edu',now());
    insert into public.profiles(id,display_name) values ('${A}','Alice'),('${B}','Bob');
    insert into auth.sessions(id,user_id) values ('${SESSION}','${B}');`);
});
afterAll(async () => { await db?.close(); });

it("设备绑定取自可信会话，客户端不能读取设备表或替其他账号登记", async () => {
  expect(await user(B, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}') as status`)).toEqual([{ status: "registered" }]);
  expect((await db.query("select user_id,session_id from public.mobile_push_devices")).rows).toEqual([{ user_id: B, session_id: SESSION }]);
  await expect(user(A, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}')`)).rejects.toThrow();
  await expect(user(B, "select * from public.mobile_push_devices")).rejects.toThrow(/permission denied/);
  await expect(user(B, "select * from public.claim_mobile_push_jobs(5)")).rejects.toThrow(/permission denied/);
});

async function message() {
  const request = await user(A, `select request_id from public.send_friend_request('${B}','hello')`);
  const accepted = await user(B, `select conversation_id from public.respond_to_friend_request('${request[0].request_id}','accept')`);
  const conversation = accepted[0].conversation_id as string;
  await user(B, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}')`);
  const clientId = "33333333-3333-4333-8333-333333333333";
  const sent = await user(A, `select message_id::text from public.send_conversation_message('${conversation}','private secret body','${clientId}')`);
  return { conversation, id: sent[0].message_id as string, clientId };
}

it("落库与推送同一事务入队；领取只含发送者和目标，不含正文；租约和消息 UUID 保证重复调用不重复创建任务", async () => {
  const m = await message();
  await user(A, `select * from public.send_conversation_message('${m.conversation}','private secret body','${m.clientId}')`);
  const claimed = await service("select * from public.claim_mobile_push_jobs(5)");
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({ sender_name: "Alice", recipient_id: B, conversation_id: m.conversation, device_token: TOKEN });
  expect(JSON.stringify(claimed)).not.toContain("private secret body");
  expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]);
  expect(await service(`select public.finish_mobile_push_job('${claimed[0].job_id}','${claimed[0].lease}','sent') as status`)).toEqual([{ status: "recorded" }]);
  expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]);
});

it("相同绑定的登记重试保留 pending／retry 任务，真正轮换 token 才清旧任务", async () => {
  await message();
  await user(B, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}')`);
  const [job] = await service("select * from public.claim_mobile_push_jobs(5)");
  expect(job).toBeDefined();
  await service(`select public.finish_mobile_push_job('${job.job_id}','${job.lease}','retry')`);
  await user(B, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}')`);
  expect((await db.query("select state,attempts from public.mobile_push_jobs")).rows).toEqual([{ state: "pending", attempts: 1 }]);
  await user(B, `select public.register_mobile_push_device('${DEVICE}','${"cd".repeat(32)}')`);
  expect((await db.query("select * from public.mobile_push_jobs")).rows).toEqual([]);
});

it.each(["hide", "block", "session", "expired_session", "clear", "school", "delete"])("投递前重新校验 %s，不向已失去资格的目标发送", async change => {
  const m = await message();
  if (change === "hide") await user(B, `select * from public.set_friend_hidden('${A}',true)`);
  if (change === "block") await user(B, `select * from public.set_member_blocked('${A}',true)`);
  if (change === "session") await db.exec("delete from auth.sessions");
  if (change === "expired_session") await db.exec("update auth.sessions set not_after=now()-interval '1 minute'");
  if (change === "clear") await user(B, `select * from public.clear_direct_conversation('${m.conversation}',${m.id})`);
  if (change === "school") await db.exec("update public.schools set enabled=false where id='uw-madison'");
  if (change === "delete") await db.exec(`update public.messages set deleted_at=now(),sender_id=null,body='[消息已删除]',client_message_id=null where id=${m.id}`);
  try { expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]); }
  finally { await db.exec("update public.schools set enabled=true where id='uw-madison'"); }
});

it("暂时失败可以重试，崩溃租约可恢复；旧租约不能完成新任务，失效 token 解绑设备", async () => {
  await message();
  const [old] = await service("select * from public.claim_mobile_push_jobs(5)");
  await db.exec("update public.mobile_push_jobs set available_at=now()-interval '1 second'");
  const [current] = await service("select * from public.claim_mobile_push_jobs(5)");
  expect(current.job_id).toBe(old.job_id);
  expect(current.lease).not.toBe(old.lease);
  expect(await service(`select public.finish_mobile_push_job('${old.job_id}','${old.lease}','sent') as status`)).toEqual([{ status: "stale" }]);
  await service(`select public.finish_mobile_push_job('${current.job_id}','${current.lease}','retry')`);
  expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]);
  await db.exec("update public.mobile_push_jobs set available_at=now()-interval '1 second'");
  const [retry] = await service("select * from public.claim_mobile_push_jobs(5)");
  await service(`select public.finish_mobile_push_job('${retry.job_id}','${retry.lease}','invalid_token')`);
  expect((await db.query("select * from public.mobile_push_devices")).rows).toEqual([]);
});

it("切换账号／token 会丢弃旧任务，旧回执不会删除新账号设备；当前设备退出不会解绑另一会话", async () => {
  await message();
  const [old] = await service("select * from public.claim_mobile_push_jobs(5)");
  const otherSession = "44444444-4444-4444-8444-444444444444";
  await db.exec(`insert into auth.sessions(id,user_id) values ('${otherSession}','${A}')`);
  await user(A, `select public.register_mobile_push_device('${DEVICE}','${TOKEN}')`, otherSession);
  expect(await service(`select public.finish_mobile_push_job('${old.job_id}','${old.lease}','invalid_token') as status`)).toEqual([{ status: "stale" }]);
  await user(B, "select public.remove_mobile_push_device()");
  expect((await db.query("select user_id from public.mobile_push_devices")).rows).toEqual([{ user_id: A }]);
  await user(A, "select public.remove_mobile_push_device()", otherSession);
  expect((await db.query("select * from public.mobile_push_devices")).rows).toEqual([]);
});

it("测试与正式环境分别领取；重试超过上限或超过五分钟不再投递", async () => {
  await message();
  expect(await service("select * from public.claim_mobile_push_jobs(5,'production')")).toEqual([]);
  for (let i=0;i<4;i++) {
    await db.exec("update public.mobile_push_jobs set available_at=now()-interval '1 second'");
    const [job] = await service("select * from public.claim_mobile_push_jobs(5)");
    expect(job).toBeDefined();
    await service(`select public.finish_mobile_push_job('${job.job_id}','${job.lease}','retry')`);
  }
  await db.exec("update public.mobile_push_jobs set available_at=now()-interval '1 second'");
  expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]);
});

it("过期消息不会投递；原生队列清理随成员永久删除级联，普通角色不能任意触发发送", async () => {
  const m = await message();
  await db.exec(`update public.messages set created_at=now()-interval '6 minutes' where id=${m.id}`);
  expect(await service("select * from public.claim_mobile_push_jobs(5)")).toEqual([]);
  await db.exec(`delete from public.member_accounts where user_id='${B}'`);
  expect((await db.query("select * from public.mobile_push_devices")).rows).toEqual([]);
  expect((await db.query("select * from public.mobile_push_jobs")).rows).toEqual([]);
  await db.exec("set role anon");
  try { await expect(db.query("select * from public.claim_mobile_push_jobs(5)")).rejects.toThrow(/permission denied/); }
  finally { await db.exec("reset role"); }
});
