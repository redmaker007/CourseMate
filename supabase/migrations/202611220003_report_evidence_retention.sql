-- 举报证据到期清理（2026-11-23 用户决定：处理完一年后删除正文）。
-- 1. behavior_reports.resolved_at：状态离开 pending 时由触发器记录，回到 pending 时清空。
--    迁移前已处理的举报没有处理时间，保守地从本迁移应用时开始计算。
-- 2. redact_expired_report_evidence()：只由数据库负责人／service_role 执行（每月一次，见
--    docs/runbooks/report-handling.md）。对处理满一年的举报：
--    - 证据快照只保留类别、ID 和时间，去掉正文、附言、资料等内容，标记 redacted；
--    - 举报人填写的补充说明换成占位（可能引用了原文）；
--    - 删除 report_source_retention 留存行，被举报消息不再阻止后续清理。
--    原因（reason）和处理结果（status）保留。
-- 证据仍然不可变：只有本函数在事务内设置的开关、且以函数所有者身份执行时才放行，
-- 与永久注销（202610260001）的例外方式相同。
begin;

alter table public.behavior_reports add column resolved_at timestamptz;
update public.behavior_reports set resolved_at = now() where status <> 'pending';
alter table public.behavior_reports add constraint behavior_reports_resolved_at_check
  check ((status = 'pending') = (resolved_at is null));

alter table public.report_evidence add column redacted_at timestamptz;

create or replace function public.set_report_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    new.resolved_at := null;
  elsif old.status = 'pending' or new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.set_report_resolved_at() from public, anon, authenticated;

create trigger behavior_reports_resolved_at
  before update of status on public.behavior_reports
  for each row execute function public.set_report_resolved_at();

create or replace function public.redact_expired_report_evidence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired uuid[];
begin
  -- 与举报写入、永久注销共用锁，避免和它们交错修改同一批证据。
  perform pg_advisory_xact_lock(hashtextextended('coursemate:report-account-lifecycle', 0));
  select coalesce(array_agg(report.id), '{}') into expired
  from public.behavior_reports report
  join public.report_evidence evidence on evidence.report_id = report.id
  where report.status <> 'pending'
    and report.resolved_at <= now() - interval '1 year'
    and evidence.redacted_at is null;
  if cardinality(expired) = 0 then
    return 0;
  end if;

  perform set_config('coursemate.report_retention', 'on', true);
  update public.report_evidence
    set snapshot = jsonb_strip_nulls(jsonb_build_object(
          'target_type', snapshot -> 'target_type',
          'message_id', snapshot -> 'message_id',
          'request_id', snapshot -> 'request_id',
          'conversation_id', snapshot -> 'conversation_id',
          'conversation_kind', snapshot -> 'conversation_kind',
          'course_id', snapshot -> 'course_id',
          'created_at', snapshot -> 'created_at',
          'subject', snapshot -> 'subject',
          'redacted', true
        )),
        redacted_at = now()
    where report_id = any(expired);
  delete from public.report_source_retention where report_id = any(expired);
  perform set_config('coursemate.report_retention', '', true);

  update public.behavior_reports
    set details = case when details is null then null else '[已清理]' end
    where id = any(expired);

  return cardinality(expired);
end;
$$;

-- 在原有“仅受控注销可改”的例外之外，增加“仅到期清理函数可改”。
create or replace function public.prevent_report_artifact_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (current_setting('coursemate.account_deletion', true) = 'on'
      and current_user = pg_catalog.pg_get_userbyid((
        select proowner from pg_catalog.pg_proc where oid = 'public.permanently_delete_member(uuid,text)'::regprocedure
      )))
    or (current_setting('coursemate.report_retention', true) = 'on'
      and current_user = pg_catalog.pg_get_userbyid((
        select proowner from pg_catalog.pg_proc where oid = 'public.redact_expired_report_evidence()'::regprocedure
      ))) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'report evidence and retention records are immutable';
end;
$$;

revoke all on function public.redact_expired_report_evidence() from public, anon, authenticated, service_role;
grant execute on function public.redact_expired_report_evidence() to service_role;
revoke all on function public.prevent_report_artifact_mutation() from public, anon, authenticated, service_role;

commit;
