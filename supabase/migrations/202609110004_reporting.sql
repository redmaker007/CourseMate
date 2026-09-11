-- Auditable member behavior reports with server-derived immutable evidence.
begin;

create table public.behavior_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_type text not null check (target_type in ('friend_request', 'message', 'profile')),
  target_id text not null check (target_id = trim(target_id) and char_length(target_id) > 0),
  reason text not null check (reason in (
    'harassment', 'spam', 'impersonation', 'threat', 'inappropriate', 'other'
  )),
  details text,
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  constraint behavior_reports_details_check check (
    (details is null or (details = trim(details) and char_length(details) between 1 and 1000))
    and (reason <> 'other' or details is not null)
  )
);

create unique index behavior_reports_one_pending_target_idx
  on public.behavior_reports (reporter_id, target_type, target_id)
  where status = 'pending';

create table public.report_evidence (
  report_id uuid primary key references public.behavior_reports(id) on delete restrict,
  reported_user_id uuid not null,
  snapshot jsonb not null,
  captured_at timestamptz not null default now()
);

create table public.report_source_retention (
  report_id uuid primary key references public.behavior_reports(id) on delete restrict,
  source_type text not null check (source_type in ('friend_request', 'message', 'profile')),
  source_id text not null,
  unique (source_type, source_id, report_id)
);

create or replace function public.prevent_report_artifact_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'report evidence and retention records are immutable';
end;
$$;

create trigger report_evidence_immutable
before update or delete on public.report_evidence
for each row execute function public.prevent_report_artifact_mutation();

create trigger report_source_retention_immutable
before update or delete on public.report_source_retention
for each row execute function public.prevent_report_artifact_mutation();

revoke execute on function public.prevent_report_artifact_mutation() from public;

alter table public.behavior_reports enable row level security;
alter table public.report_evidence enable row level security;
alter table public.report_source_retention enable row level security;

revoke all on public.behavior_reports from anon, authenticated;
revoke all on public.report_evidence from anon, authenticated;
revoke all on public.report_source_retention from anon, authenticated;
grant select on public.behavior_reports to authenticated;

create policy behavior_reports_select_own
  on public.behavior_reports for select to authenticated
  using (public.has_completed_onboarding() and reporter_id = auth.uid());

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
            and target_account.school_id = public.current_school_id()
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

revoke execute on function public.create_behavior_report(text, text, text, text) from public;
grant execute on function public.create_behavior_report(text, text, text, text) to authenticated;

commit;
