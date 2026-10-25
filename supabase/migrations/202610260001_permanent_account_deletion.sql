-- 永久注销的受控事务与无身份完成回执；客户端不得直接指定删除对象。
begin;

create table public.account_deletion_receipts (
  receipt_hash text primary key check (receipt_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz not null default now()
);
alter table public.account_deletion_receipts enable row level security;
revoke all on public.account_deletion_receipts from public, anon, authenticated, service_role;

create or replace function public.get_account_deletion_receipt(receipt_digest text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  if receipt_digest is null or receipt_digest !~ '^[0-9a-f]{64}$' then return 'invalid_request'; end if;
  if exists (select 1 from public.account_deletion_receipts where receipt_hash = receipt_digest) then return 'completed'; end if;
  return 'not_completed';
end;
$$;

create or replace function public.permanently_delete_member(target_user uuid, receipt_digest text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  account_email text;
  related_reports uuid[];
  has_objects boolean := false;
begin
  if target_user is null or receipt_digest is null or receipt_digest !~ '^[0-9a-f]{64}$' then return 'invalid_request'; end if;
  -- shortcut: 当前规模串行化举报写入与注销；大量并行举报时改为按成员有序加锁并复验目标。
  perform pg_advisory_xact_lock(hashtextextended('coursemate:report-account-lifecycle', 0));
  if exists (select 1 from public.account_deletion_receipts where receipt_hash = receipt_digest) then return 'completed'; end if;
  select email into account_email from auth.users where id = target_user for update;
  if not found then return 'not_available'; end if;
  -- 先锁成员，等待已有带外键的写事务完成，阻止注销期间新增本人关系和消息。
  perform 1 from public.member_accounts where user_id = target_user for update;
  if exists (select 1 from public.platform_roles where user_id = target_user and role = 'owner') then return 'owner_transfer_required'; end if;

  -- 本项目没有对象上传链；不能把残留 Storage 对象当作已清理。
  if to_regclass('storage.objects') is not null then
    if exists (select 1 from pg_catalog.pg_attribute where attrelid = 'storage.objects'::regclass and attname = 'owner_id' and not attisdropped) then
      execute 'select exists(select 1 from storage.objects where owner_id::text = $1)' into has_objects using target_user::text;
    end if;
    if not has_objects and exists (select 1 from pg_catalog.pg_attribute where attrelid = 'storage.objects'::regclass and attname = 'owner' and not attisdropped) then
      execute 'select exists(select 1 from storage.objects where owner::text = $1)' into has_objects using target_user::text;
    end if;
    if has_objects then return 'storage_cleanup_required'; end if;
  end if;

  select array_agg(distinct report.id) into related_reports
  from public.behavior_reports report
  left join public.report_evidence evidence on evidence.report_id = report.id
  left join public.report_source_retention retention on retention.report_id = report.id
  where report.reporter_id = target_user or evidence.reported_user_id = target_user
    or (report.target_type = 'profile' and lower(report.target_id) = target_user::text)
    or retention.message_id in (select id from public.messages where sender_id = target_user)
    or (retention.source_type = 'friend_request' and lower(retention.source_id) in (
      select id::text from public.friend_requests where target_user in (pair_low, pair_high, requester_id, recipient_id)
    ));

  -- 仅此受控 SECURITY DEFINER 调用可在事务内释放不可变的本人关联材料。
  perform set_config('coursemate.account_deletion', 'on', true);
  delete from public.report_source_retention where report_id = any(related_reports);
  delete from public.report_evidence where report_id = any(related_reports);
  delete from public.behavior_reports where id = any(related_reports);
  perform set_config('coursemate.account_deletion', '', true);

  -- 必要占位保留 ID／会话顺序，所有本人正文和可识别发送关联都移除。
  update public.messages set sender_id = null, body = '[消息已删除]', deleted_at = coalesce(deleted_at, now()),
    client_message_id = null, source_friend_request_id = null
  where sender_id = target_user;
  delete from public.friend_request_active_pairs where target_user in (pair_low, pair_high);
  delete from public.friend_requests where target_user in (pair_low, pair_high, requester_id, recipient_id);

  -- 使用同一数据库事务删除 Auth 主记录，依赖其真实外键级联而非另一次 HTTP 调用。
  delete from auth.users where id = target_user;
  -- 旧版 refresh_tokens.user_id 是文本且没有账号外键，不能只依赖 sessions 的级联。
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1' using target_user::text;
  end if;
  -- 已持有子行的管理事务会在账号级联前完成，此后清理其明确的身份字段。
  update public.admin_audit_log
    set target = case when target = target_user::text then null else target end,
        details = case when lower(details ->> 'email') = lower(account_email) then details - 'email' else details end
    where target = target_user::text or lower(details ->> 'email') = lower(account_email);
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload::jsonb ->> ''actor_id'' = $1
      or lower(payload::jsonb ->> ''actor_username'') = lower($2)
      or payload::jsonb -> ''traits'' ->> ''user_id'' = $1
      or lower(payload::jsonb -> ''traits'' ->> ''email'') = lower($2)' using target_user::text, account_email;
  end if;

  insert into public.account_deletion_receipts(receipt_hash) values (receipt_digest);
  return 'completed';
end;
$$;

create or replace function public.prevent_report_artifact_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_setting('coursemate.account_deletion', true) = 'on'
    and current_user = pg_catalog.pg_get_userbyid((
      select proowner from pg_catalog.pg_proc where oid = 'public.permanently_delete_member(uuid,text)'::regprocedure
    )) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'report evidence and retention records are immutable';
end;
$$;

create or replace function public.create_behavior_report(
  target_type text,
  target_id text,
  report_reason text,
  report_details text default null
)
returns table (result_status text, report_id uuid)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_details text := nullif(trim(report_details), '');
  normalized_target text := trim(target_id);
  subject_id uuid;
  evidence_snapshot jsonb;
  created_report_id uuid;
  existing_report_id uuid;
  target_uuid uuid;
  target_message_id bigint;
begin
  -- 注销和举报共用短事务锁，避免注销后又写回旧证据快照。
  perform pg_advisory_xact_lock(hashtextextended('coursemate:report-account-lifecycle', 0));
  if not public.has_completed_onboarding() then
    return query select 'onboarding_required'::text, null::uuid;
    return;
  end if;

  if report_reason not in ('harassment', 'spam', 'impersonation', 'threat', 'inappropriate', 'other') then
    return query select 'invalid_reason'::text, null::uuid;
    return;
  end if;
  if char_length(normalized_details) > 1000
     or (report_reason = 'other' and normalized_details is null) then
    return query select 'invalid_details'::text, null::uuid;
    return;
  end if;

  if target_type in ('friend_request', 'profile') then
    if normalized_target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return query select 'invalid_target'::text, null::uuid;
      return;
    end if;
    target_uuid := normalized_target::uuid;
  elsif target_type = 'message' then
    if normalized_target !~ '^[1-9][0-9]*$' then
      return query select 'invalid_target'::text, null::uuid;
      return;
    end if;
    begin
      target_message_id := normalized_target::bigint;
    exception when numeric_value_out_of_range then
      return query select 'invalid_target'::text, null::uuid;
      return;
    end;
  else
    return query select 'invalid_target'::text, null::uuid;
    return;
  end if;

  if target_type = 'friend_request' then
    if exists (
      select 1 from public.friend_requests request
      where request.id = target_uuid and request.requester_id = actor
    ) then
      return query select 'self_report'::text, null::uuid;
      return;
    end if;
    select request.requester_id,
      jsonb_build_object(
        'target_type', 'friend_request', 'request_id', request.id,
        'message', request.message, 'status', request.status,
        'created_at', request.created_at, 'expires_at', request.expires_at
      )
    into subject_id, evidence_snapshot
    from public.friend_requests request
    where request.id = target_uuid and request.recipient_id = actor;
  elsif target_type = 'message' then
    if exists (
      select 1 from public.messages message
      where message.id = target_message_id and message.sender_id = actor
    ) then
      return query select 'self_report'::text, null::uuid;
      return;
    end if;
    select message.sender_id,
      jsonb_build_object(
        'target_type', 'message', 'message_id', message.id,
        'conversation_id', message.conversation_id, 'body', message.body,
        'created_at', message.created_at
      )
    into subject_id, evidence_snapshot
    from public.messages message
    where message.id = target_message_id
      and message.sender_id is not null
      and message.deleted_at is null
      and public.can_access_direct_conversation(message.conversation_id)
      and exists (
        select 1 from public.conversation_members membership
        where membership.conversation_id = message.conversation_id
          and membership.user_id = actor
          and (
            membership.cleared_through_message_id is null
            or message.id > membership.cleared_through_message_id
          )
      );
  else
    if target_uuid = actor then
      return query select 'self_report'::text, null::uuid;
      return;
    end if;
    select profile.id,
      jsonb_build_object(
        'target_type', 'profile', 'profile_id', profile.id,
        'display_name', profile.display_name, 'avatar_url', profile.avatar_url,
        'major', profile.major, 'grad_year', profile.grad_year
      )
    into subject_id, evidence_snapshot
    from public.profiles profile
    where profile.id = target_uuid
      and (
        exists (
          select 1 from public.member_accounts target_account
          where target_account.user_id = profile.id
            and public.effective_member_school_id(target_account.user_id) = public.current_school_id()
        )
        or public.shares_course_with(profile.id)
        or exists (
          select 1 from public.friendships friendship
          where friendship.pair_low = least(actor, profile.id)
            and friendship.pair_high = greatest(actor, profile.id)
            and friendship.active
        )
        or exists (
          select 1 from public.friend_requests request
          where actor in (request.requester_id, request.recipient_id)
            and profile.id in (request.requester_id, request.recipient_id)
        )
      );
  end if;

  if subject_id is null or evidence_snapshot is null then
    return query select 'not_available'::text, null::uuid;
    return;
  end if;
  if subject_id = actor then
    return query select 'self_report'::text, null::uuid;
    return;
  end if;

  insert into public.behavior_reports
    (reporter_id, target_type, target_id, reason, details)
  values (actor, target_type, normalized_target, report_reason, normalized_details)
  on conflict do nothing
  returning id into created_report_id;

  if created_report_id is null then
    select report.id into existing_report_id
    from public.behavior_reports report
    where report.reporter_id = actor
      and report.target_type = create_behavior_report.target_type
      and report.target_id = normalized_target
      and report.status = 'pending';
    return query select 'already_pending'::text, existing_report_id;
    return;
  end if;

  insert into public.report_evidence
    (report_id, reported_user_id, snapshot)
  values (created_report_id, subject_id, evidence_snapshot);
  insert into public.report_source_retention
    (report_id, source_type, source_id)
  values (created_report_id, target_type, normalized_target);

  return query select 'created'::text, created_report_id;
end;
$$;

revoke all on function public.permanently_delete_member(uuid, text), public.get_account_deletion_receipt(text)
  from public, anon, authenticated, service_role;
grant execute on function public.permanently_delete_member(uuid, text), public.get_account_deletion_receipt(text) to service_role;
revoke all on function public.prevent_report_artifact_mutation() from public, anon, authenticated, service_role;
commit;
