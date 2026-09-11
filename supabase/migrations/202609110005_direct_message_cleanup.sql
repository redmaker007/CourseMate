-- Safe, auditable physical cleanup for fully-cleared direct messages.
begin;

-- Read and clear positions are durable high-water marks. They must survive the
-- physical removal of the message that originally established the position.
alter table public.conversation_members
  drop constraint conversation_members_last_read_message_fkey,
  drop constraint conversation_members_cleared_message_fkey;

create table public.direct_message_clear_ranges (
  id bigint generated always as identity primary key,
  conversation_id uuid not null,
  member_id uuid not null,
  after_message_id bigint not null,
  through_message_id bigint not null,
  cleared_at timestamptz not null,
  constraint direct_message_clear_ranges_order_check check (
    after_message_id >= 0 and through_message_id > after_message_id
  ),
  constraint direct_message_clear_ranges_member_fkey
    foreign key (conversation_id, member_id)
    references public.conversation_members(conversation_id, user_id)
    on delete cascade,
  unique (conversation_id, member_id, after_message_id)
);

create index direct_message_clear_ranges_cover_idx
  on public.direct_message_clear_ranges
    (conversation_id, member_id, through_message_id, after_message_id);

create table public.direct_message_cleanup_eligibility (
  message_id bigint primary key,
  conversation_id uuid not null,
  eligible_since timestamptz not null,
  constraint direct_message_cleanup_eligibility_message_fkey
    foreign key (conversation_id, message_id)
    references public.messages(conversation_id, id)
    on delete cascade
);

create index direct_message_cleanup_eligibility_batch_idx
  on public.direct_message_cleanup_eligibility (eligible_since, message_id);

create table public.direct_message_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  run_mode text not null check (run_mode in ('dry_run', 'execute')),
  evaluated_at timestamptz not null,
  batch_size integer not null check (batch_size between 1 and 1000),
  candidate_message_ids bigint[] not null default '{}'::bigint[],
  deleted_message_ids bigint[] not null default '{}'::bigint[],
  candidate_count integer not null default 0,
  deleted_count integer not null default 0,
  result_status text not null check (result_status in ('running', 'completed', 'failed')),
  error_details text,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);

alter table public.direct_message_clear_ranges enable row level security;
alter table public.direct_message_cleanup_eligibility enable row level security;
alter table public.direct_message_cleanup_runs enable row level security;

revoke all on public.direct_message_clear_ranges from anon, authenticated;
revoke all on public.direct_message_cleanup_eligibility from anon, authenticated;
revoke all on public.direct_message_cleanup_runs from anon, authenticated;
grant select on public.direct_message_cleanup_runs to service_role;

-- A generated typed reference turns the polymorphic retention row into a real
-- database-level hold for message reports. It also closes insert/delete races.
alter table public.report_source_retention
  add column message_id bigint generated always as (
    case when source_type = 'message' then source_id::bigint else null end
  ) stored;

alter table public.report_source_retention
  add constraint report_source_retention_message_fkey
  foreign key (message_id) references public.messages(id) on delete restrict;

create index report_source_retention_message_idx
  on public.report_source_retention (message_id)
  where message_id is not null;

-- Existing positions predate range tracking. Their latest clear timestamp is a
-- conservative lower bound: it may delay old cleanup, but never accelerates it.
insert into public.direct_message_clear_ranges
  (conversation_id, member_id, after_message_id, through_message_id, cleared_at)
select member.conversation_id, member.user_id, 0,
  member.cleared_through_message_id, member.cleared_at
from public.conversation_members member
join public.direct_conversations direct
  on direct.conversation_id = member.conversation_id
where member.cleared_through_message_id is not null
  and member.cleared_at is not null;

insert into public.direct_message_cleanup_eligibility
  (message_id, conversation_id, eligible_since)
select message.id, message.conversation_id,
  greatest(low_range.cleared_at, high_range.cleared_at)
from public.messages message
join public.direct_conversations direct
  on direct.conversation_id = message.conversation_id
join public.direct_message_clear_ranges low_range
  on low_range.conversation_id = message.conversation_id
 and low_range.member_id = direct.member_low
 and message.id > low_range.after_message_id
 and message.id <= low_range.through_message_id
join public.direct_message_clear_ranges high_range
  on high_range.conversation_id = message.conversation_id
 and high_range.member_id = direct.member_high
 and message.id > high_range.after_message_id
 and message.id <= high_range.through_message_id
on conflict (message_id) do nothing;

create or replace function public.clear_direct_conversation(
  target_conversation_id uuid,
  through_message_id bigint
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  requested_through bigint := through_message_id;
  previous_position bigint;
  clear_time timestamptz;
  low_member_id uuid;
  high_member_id uuid;
begin
  if not public.can_access_direct_conversation(target_conversation_id) then
    return 'not_available';
  end if;
  if not exists (
    select 1 from public.messages message
    where message.conversation_id = target_conversation_id
      and message.id = requested_through
  ) then
    return 'invalid_cursor';
  end if;

  -- One lock serializes both members' advancing clear operations and cleanup.
  select direct.member_low, direct.member_high
  into low_member_id, high_member_id
  from public.direct_conversations direct
  where direct.conversation_id = target_conversation_id
  for update;

  select member.cleared_through_message_id
  into previous_position
  from public.conversation_members member
  where member.conversation_id = target_conversation_id
    and member.user_id = actor
  for update;

  previous_position := coalesce(previous_position, 0);
  if requested_through <= previous_position then
    return 'updated';
  end if;

  clear_time := clock_timestamp();
  insert into public.direct_message_clear_ranges
    (conversation_id, member_id, after_message_id, through_message_id, cleared_at)
  values (
    target_conversation_id, actor, previous_position, requested_through, clear_time
  );

  update public.conversation_members member
  set cleared_through_message_id = requested_through,
      cleared_at = clear_time
  where member.conversation_id = target_conversation_id
    and member.user_id = actor;

  insert into public.direct_message_cleanup_eligibility
    (message_id, conversation_id, eligible_since)
  select message.id, message.conversation_id,
    greatest(clear_time, other_range.cleared_at)
  from public.messages message
  join public.direct_message_clear_ranges other_range
    on other_range.conversation_id = message.conversation_id
   and other_range.member_id <> actor
   and message.id > other_range.after_message_id
   and message.id <= other_range.through_message_id
  where message.conversation_id = target_conversation_id
    and message.id > previous_position
    and message.id <= requested_through
    and actor in (low_member_id, high_member_id)
  on conflict (message_id) do nothing;

  return 'updated';
end;
$$;

revoke execute on function public.clear_direct_conversation(uuid, bigint) from public;
grant execute on function public.clear_direct_conversation(uuid, bigint) to authenticated;

create or replace function public.eligible_direct_message_cleanup(
  evaluation_time timestamptz
)
returns table (
  message_id bigint,
  conversation_id uuid,
  eligible_since timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select eligibility.message_id, eligibility.conversation_id,
    eligibility.eligible_since
  from public.direct_message_cleanup_eligibility eligibility
  join public.messages message on message.id = eligibility.message_id
  join public.conversations conversation
    on conversation.id = eligibility.conversation_id
   and conversation.kind = 'direct'
  join public.direct_conversations direct
    on direct.conversation_id = eligibility.conversation_id
   and direct.member_low is not null
   and direct.member_high is not null
  join public.conversation_members low_member
    on low_member.conversation_id = direct.conversation_id
   and low_member.user_id = direct.member_low
  join public.conversation_members high_member
    on high_member.conversation_id = direct.conversation_id
   and high_member.user_id = direct.member_high
  -- The retention period is an exact elapsed duration. Using "30 days" here
  -- would follow session-local calendar days and can become 719 hours across DST.
  where eligibility.eligible_since <= evaluation_time - interval '720 hours'
    and not exists (
      select 1 from public.report_source_retention retention
      where retention.message_id = eligibility.message_id
    );
$$;

revoke execute on function public.eligible_direct_message_cleanup(timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.preview_direct_message_cleanup(
  evaluation_time timestamptz default clock_timestamp(),
  requested_batch_size integer default 100
)
returns table (
  audit_id uuid,
  candidate_count integer,
  message_ids bigint[]
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  selected_ids bigint[];
  created_audit_id uuid;
begin
  if evaluation_time is null
     or requested_batch_size is null
     or requested_batch_size not between 1 and 1000 then
    raise exception 'invalid direct message cleanup preview parameters';
  end if;

  select coalesce(
    array_agg(candidate.message_id order by candidate.eligible_since, candidate.message_id),
    '{}'::bigint[]
  ) into selected_ids
  from (
    select candidate.message_id, candidate.eligible_since
    from public.eligible_direct_message_cleanup(evaluation_time) candidate
    order by candidate.eligible_since, candidate.message_id
    limit requested_batch_size
  ) candidate;

  insert into public.direct_message_cleanup_runs
    (run_mode, evaluated_at, batch_size, candidate_message_ids,
     candidate_count, result_status, finished_at)
  values (
    'dry_run', evaluation_time, requested_batch_size, selected_ids,
    cardinality(selected_ids), 'completed', clock_timestamp()
  )
  returning id into created_audit_id;

  return query select created_audit_id, cardinality(selected_ids), selected_ids;
end;
$$;

revoke execute on function public.preview_direct_message_cleanup(timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.preview_direct_message_cleanup(timestamptz, integer)
to service_role;

create or replace function public.run_direct_message_cleanup(
  requested_batch_size integer default 100
)
returns table (
  audit_id uuid,
  result_status text,
  candidate_count integer,
  deleted_count integer,
  message_ids bigint[]
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  evaluation_time timestamptz := clock_timestamp();
  locked_ids bigint[] := '{}'::bigint[];
  removed_ids bigint[] := '{}'::bigint[];
  created_audit_id uuid;
  failure_message text;
begin
  if requested_batch_size is null or requested_batch_size not between 1 and 1000 then
    raise exception 'invalid direct message cleanup batch size';
  end if;

  insert into public.direct_message_cleanup_runs
    (run_mode, evaluated_at, batch_size, result_status)
  values ('execute', evaluation_time, requested_batch_size, 'running')
  returning id into created_audit_id;

  begin
    select coalesce(
      array_agg(locked.message_id order by locked.eligible_since, locked.message_id),
      '{}'::bigint[]
    ) into locked_ids
    from (
      select candidate.message_id, candidate.eligible_since
      from public.eligible_direct_message_cleanup(evaluation_time) candidate
      join public.messages message on message.id = candidate.message_id
      join public.direct_conversations direct
        on direct.conversation_id = candidate.conversation_id
      join public.conversation_members low_member
        on low_member.conversation_id = direct.conversation_id
       and low_member.user_id = direct.member_low
      join public.conversation_members high_member
        on high_member.conversation_id = direct.conversation_id
       and high_member.user_id = direct.member_high
      order by candidate.eligible_since, candidate.message_id
      limit requested_batch_size
      for update of message, direct, low_member, high_member skip locked
    ) locked;

    with removed as (
      delete from public.messages message
      where message.id = any(locked_ids)
        and message.id in (
          select candidate.message_id
          from public.eligible_direct_message_cleanup(evaluation_time) candidate
        )
      returning message.id
    )
    select coalesce(array_agg(removed.id order by removed.id), '{}'::bigint[])
    into removed_ids
    from removed;

    update public.direct_message_cleanup_runs cleanup_run
    set candidate_message_ids = locked_ids,
        deleted_message_ids = removed_ids,
        candidate_count = cardinality(locked_ids),
        deleted_count = cardinality(removed_ids),
        result_status = 'completed',
        finished_at = clock_timestamp()
    where cleanup_run.id = created_audit_id;

    return query select created_audit_id, 'completed'::text,
      cardinality(locked_ids), cardinality(removed_ids), removed_ids;
  exception when others then
    get stacked diagnostics failure_message = message_text;
    update public.direct_message_cleanup_runs cleanup_run
    set candidate_message_ids = locked_ids,
        candidate_count = cardinality(locked_ids),
        result_status = 'failed',
        error_details = failure_message,
        finished_at = clock_timestamp()
    where cleanup_run.id = created_audit_id;

    return query select created_audit_id, 'failed'::text,
      cardinality(locked_ids), 0, '{}'::bigint[];
  end;
end;
$$;

revoke execute on function public.run_direct_message_cleanup(integer)
from public, anon, authenticated;
grant execute on function public.run_direct_message_cleanup(integer)
to service_role;

commit;
