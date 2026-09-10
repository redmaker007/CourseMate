-- Friend discovery and relationship backend

begin;

create table public.friend_rate_limit_config (
  action_kind text primary key,
  minute_limit integer not null check (minute_limit > 0),
  hour_limit integer not null check (hour_limit > 0)
);

insert into public.friend_rate_limit_config
  (action_kind, minute_limit, hour_limit)
values
  ('member_search', 5, 30),
  ('friend_request', 5, 30);

create table public.friend_rate_limit_buckets (
  actor_id uuid not null references public.member_accounts(user_id) on delete cascade,
  action_kind text not null references public.friend_rate_limit_config(action_kind),
  window_seconds integer not null check (window_seconds in (60, 3600)),
  window_start bigint not null,
  request_count integer not null check (request_count > 0),
  primary key (actor_id, action_kind, window_seconds, window_start)
);

revoke all on public.friend_rate_limit_config from anon, authenticated;
revoke all on public.friend_rate_limit_buckets from anon, authenticated;

create or replace function public.consume_friend_rate_limit(target_action text)
returns boolean
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  minute_max integer;
  hour_max integer;
  minute_count integer;
  hour_count integer;
  epoch_seconds bigint := floor(extract(epoch from clock_timestamp()))::bigint;
begin
  if actor is null then
    return false;
  end if;

  select minute_limit, hour_limit
  into minute_max, hour_max
  from public.friend_rate_limit_config
  where action_kind = target_action;

  if not found then
    return false;
  end if;

  delete from public.friend_rate_limit_buckets bucket
  where bucket.actor_id = actor
    and bucket.action_kind = target_action
    and (
      (bucket.window_seconds = 60 and bucket.window_start <> epoch_seconds / 60)
      or
      (bucket.window_seconds = 3600 and bucket.window_start <> epoch_seconds / 3600)
    );

  insert into public.friend_rate_limit_buckets
    (actor_id, action_kind, window_seconds, window_start, request_count)
  values (actor, target_action, 60, epoch_seconds / 60, 1)
  on conflict (actor_id, action_kind, window_seconds, window_start)
  do update set request_count = public.friend_rate_limit_buckets.request_count + 1
  returning request_count into minute_count;

  insert into public.friend_rate_limit_buckets
    (actor_id, action_kind, window_seconds, window_start, request_count)
  values (actor, target_action, 3600, epoch_seconds / 3600, 1)
  on conflict (actor_id, action_kind, window_seconds, window_start)
  do update set request_count = public.friend_rate_limit_buckets.request_count + 1
  returning request_count into hour_count;

  return minute_count <= minute_max and hour_count <= hour_max;
end;
$$;

revoke execute on function public.consume_friend_rate_limit(text) from public;

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.member_accounts(user_id) on delete set null,
  recipient_id uuid references public.member_accounts(user_id) on delete set null,
  pair_low uuid not null,
  pair_high uuid not null,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  constraint friend_requests_distinct_pair check (pair_low < pair_high),
  constraint friend_requests_participants_match_pair check (
    requester_id is null
    or recipient_id is null
    or (
      pair_low = least(requester_id, recipient_id)
      and pair_high = greatest(requester_id, recipient_id)
    )
  ),
  constraint friend_requests_message_check check (
    message = trim(message) and char_length(message) between 1 and 300
  ),
  constraint friend_requests_fixed_expiry check (
    expires_at = created_at + interval '3 days'
  )
);

create table public.friend_request_active_pairs (
  pair_low uuid not null,
  pair_high uuid not null,
  request_id uuid not null unique
    references public.friend_requests(id) on delete cascade,
  primary key (pair_low, pair_high),
  constraint friend_request_active_distinct_pair check (pair_low < pair_high)
);

alter table public.friend_requests enable row level security;
alter table public.friend_request_active_pairs enable row level security;

revoke all on public.friend_requests from anon, authenticated;
revoke all on public.friend_request_active_pairs from anon, authenticated;
grant select on public.friend_requests to authenticated;

create policy friend_requests_select_participant
  on public.friend_requests
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and auth.uid() in (requester_id, recipient_id)
  );

create or replace function public.send_friend_request(
  target_member_id uuid,
  request_message text
)
returns table (result_status text, request_id uuid)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_school text;
  target_school text;
  normalized_message text := trim(request_message);
  low_member uuid;
  high_member uuid;
  active_request public.friend_requests%rowtype;
  created_request_id uuid;
  created_at_value timestamptz := clock_timestamp();
begin
  if not public.has_completed_onboarding() then
    return query select 'onboarding_required'::text, null::uuid;
    return;
  end if;

  if target_member_id is null or target_member_id = actor then
    return query select 'invalid_target'::text, null::uuid;
    return;
  end if;

  if char_length(normalized_message) not between 1 and 300 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select school_id into actor_school
  from public.member_accounts where user_id = actor;
  select account.school_id into target_school
  from public.member_accounts account
  join public.profiles profile on profile.id = account.user_id
  where account.user_id = target_member_id
    and char_length(trim(profile.display_name)) between 1 and 15;

  if target_school is null or target_school <> actor_school then
    return query select 'not_available'::text, null::uuid;
    return;
  end if;

  if public.members_are_blocked(actor, target_member_id) then
    return query select 'blocked'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.friendships friendship
    where friendship.pair_low = least(actor, target_member_id)
      and friendship.pair_high = greatest(actor, target_member_id)
      and friendship.active
  ) then
    return query select 'already_friends'::text, null::uuid;
    return;
  end if;

  if not public.consume_friend_rate_limit('friend_request') then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  low_member := least(actor, target_member_id);
  high_member := greatest(actor, target_member_id);

  select request.* into active_request
  from public.friend_request_active_pairs active
  join public.friend_requests request on request.id = active.request_id
  where active.pair_low = low_member and active.pair_high = high_member
  for update of request;

  if found and active_request.expires_at <= created_at_value then
    update public.friend_requests
    set status = 'expired', resolved_at = created_at_value
    where id = active_request.id and status = 'pending';
    delete from public.friend_request_active_pairs
    where pair_low = low_member and pair_high = high_member;
    active_request := null;
  end if;

  if active_request.id is not null then
    return query select
      case
        when active_request.recipient_id = actor then 'incoming_request'
        else 'already_pending'
      end,
      active_request.id;
    return;
  end if;

  begin
    insert into public.friend_requests (
      requester_id, recipient_id, pair_low, pair_high, message,
      created_at, expires_at
    ) values (
      actor, target_member_id, low_member, high_member, normalized_message,
      created_at_value, created_at_value + interval '3 days'
    ) returning id into created_request_id;

    insert into public.friend_request_active_pairs
      (pair_low, pair_high, request_id)
    values (low_member, high_member, created_request_id);
  exception when unique_violation then
    select request.* into active_request
    from public.friend_request_active_pairs active
    join public.friend_requests request on request.id = active.request_id
    where active.pair_low = low_member and active.pair_high = high_member;
    return query select
      case
        when active_request.recipient_id = actor then 'incoming_request'
        else 'already_pending'
      end,
      active_request.id;
    return;
  end;

  return query select 'sent'::text, created_request_id;
end;
$$;

revoke execute on function public.send_friend_request(uuid, text) from public;
grant execute on function public.send_friend_request(uuid, text) to authenticated;

create table public.friendships (
  pair_low uuid not null references public.member_accounts(user_id) on delete cascade,
  pair_high uuid not null references public.member_accounts(user_id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  reactivated_at timestamptz,
  ended_at timestamptz,
  primary key (pair_low, pair_high),
  constraint friendships_distinct_pair check (pair_low < pair_high),
  constraint friendships_active_dates check (
    (active and ended_at is null) or (not active and ended_at is not null)
  )
);

create table public.friend_preferences (
  pair_low uuid not null,
  pair_high uuid not null,
  owner_id uuid not null references public.member_accounts(user_id) on delete cascade,
  note text,
  hidden boolean not null default false,
  primary key (pair_low, pair_high, owner_id),
  foreign key (pair_low, pair_high)
    references public.friendships(pair_low, pair_high) on delete cascade,
  constraint friend_preferences_owner_is_participant check (
    owner_id in (pair_low, pair_high)
  ),
  constraint friend_preferences_note_check check (
    note is null
    or (note = trim(note) and char_length(note) between 1 and 15)
  )
);

create table public.member_blocks (
  blocker_id uuid not null references public.member_accounts(user_id) on delete cascade,
  blocked_id uuid not null references public.member_accounts(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint member_blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.friendships enable row level security;
alter table public.friend_preferences enable row level security;
alter table public.member_blocks enable row level security;

revoke all on public.friendships from anon, authenticated;
revoke all on public.friend_preferences from anon, authenticated;
revoke all on public.member_blocks from anon, authenticated;
grant select on public.friendships to authenticated;
grant select on public.friend_preferences to authenticated;
grant select on public.member_blocks to authenticated;

create policy friendships_select_participant
  on public.friendships
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and auth.uid() in (pair_low, pair_high)
  );

create policy friend_preferences_select_owner
  on public.friend_preferences
  for select to authenticated
  using (public.has_completed_onboarding() and owner_id = auth.uid());

create policy member_blocks_select_owner
  on public.member_blocks
  for select to authenticated
  using (public.has_completed_onboarding() and blocker_id = auth.uid());

create or replace function public.members_are_blocked(first_member uuid, second_member uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.member_blocks block
    where (block.blocker_id = first_member and block.blocked_id = second_member)
       or (block.blocker_id = second_member and block.blocked_id = first_member)
  );
$$;

revoke execute on function public.members_are_blocked(uuid, uuid) from public;

create or replace function public.set_member_blocked(
  target_member_id uuid,
  requested_blocked boolean
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.has_completed_onboarding() then return 'onboarding_required'; end if;
  if target_member_id is null or target_member_id = actor then return 'not_available'; end if;
  if not exists (
    select 1
    from public.member_accounts mine
    join public.member_accounts target on target.school_id = mine.school_id
    where mine.user_id = actor and target.user_id = target_member_id
  ) then return 'not_available'; end if;

  if coalesce(requested_blocked, false) then
    insert into public.member_blocks (blocker_id, blocked_id)
    values (actor, target_member_id)
    on conflict (blocker_id, blocked_id) do nothing;
    return 'saved';
  end if;

  delete from public.member_blocks
  where blocker_id = actor and blocked_id = target_member_id;
  return 'cleared';
end;
$$;

create or replace function public.friend_relationship_status(target_member_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  low_member uuid := least(actor, target_member_id);
  high_member uuid := greatest(actor, target_member_id);
  pending public.friend_requests%rowtype;
begin
  if not public.has_completed_onboarding() then return 'onboarding_required'; end if;
  if target_member_id is null or target_member_id = actor then return 'not_available'; end if;
  if public.members_are_blocked(actor, target_member_id) then return 'blocked'; end if;
  if exists (
    select 1 from public.friendships friendship
    where friendship.pair_low = low_member
      and friendship.pair_high = high_member
      and friendship.active
  ) then return 'friend'; end if;

  select request.* into pending
  from public.friend_request_active_pairs active
  join public.friend_requests request on request.id = active.request_id
  where active.pair_low = low_member
    and active.pair_high = high_member
    and request.status = 'pending'
    and request.expires_at > now();
  if found then
    return case
      when pending.recipient_id = actor then 'incoming_request'
      else 'outgoing_request'
    end;
  end if;
  return 'none';
end;
$$;

revoke execute on function public.set_member_blocked(uuid, boolean) from public;
revoke execute on function public.friend_relationship_status(uuid) from public;
grant execute on function public.set_member_blocked(uuid, boolean) to authenticated;
grant execute on function public.friend_relationship_status(uuid) to authenticated;

create or replace function public.remove_friend(target_member_id uuid)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  low_member uuid := least(actor, target_member_id);
  high_member uuid := greatest(actor, target_member_id);
begin
  if not public.has_completed_onboarding() then return 'onboarding_required'; end if;
  if target_member_id is null or target_member_id = actor then return 'not_available'; end if;

  update public.friendships
  set active = false, ended_at = clock_timestamp()
  where pair_low = low_member and pair_high = high_member and active;

  if not found then
    if exists (
      select 1 from public.friendships friendship
      where friendship.pair_low = low_member
        and friendship.pair_high = high_member
        and not friendship.active
    ) then return 'removed'; end if;
    return 'not_friends';
  end if;

  delete from public.friend_preferences
  where pair_low = low_member and pair_high = high_member;
  return 'removed';
end;
$$;

revoke execute on function public.remove_friend(uuid) from public;
grant execute on function public.remove_friend(uuid) to authenticated;

create or replace function public.set_friend_note(
  target_member_id uuid,
  requested_note text
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  low_member uuid := least(actor, target_member_id);
  high_member uuid := greatest(actor, target_member_id);
  normalized_note text := nullif(trim(requested_note), '');
begin
  if not public.has_completed_onboarding() then return 'onboarding_required'; end if;
  if target_member_id is null or target_member_id = actor then return 'not_available'; end if;
  if normalized_note is not null and char_length(normalized_note) > 15 then
    return 'invalid';
  end if;
  if not exists (
    select 1 from public.friendships friendship
    where friendship.pair_low = low_member
      and friendship.pair_high = high_member
      and friendship.active
  ) then return 'not_friends'; end if;

  insert into public.friend_preferences
    (pair_low, pair_high, owner_id, note)
  values (low_member, high_member, actor, normalized_note)
  on conflict (pair_low, pair_high, owner_id)
  do update set note = excluded.note;

  return case when normalized_note is null then 'cleared' else 'saved' end;
end;
$$;

create or replace function public.set_friend_hidden(
  target_member_id uuid,
  requested_hidden boolean
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  low_member uuid := least(actor, target_member_id);
  high_member uuid := greatest(actor, target_member_id);
begin
  if not public.has_completed_onboarding() then return 'onboarding_required'; end if;
  if target_member_id is null or target_member_id = actor then return 'not_available'; end if;
  if not exists (
    select 1 from public.friendships friendship
    where friendship.pair_low = low_member
      and friendship.pair_high = high_member
      and friendship.active
  ) then return 'not_friends'; end if;

  insert into public.friend_preferences
    (pair_low, pair_high, owner_id, hidden)
  values (low_member, high_member, actor, coalesce(requested_hidden, false))
  on conflict (pair_low, pair_high, owner_id)
  do update set hidden = excluded.hidden;
  return 'saved';
end;
$$;

revoke execute on function public.set_friend_note(uuid, text) from public;
revoke execute on function public.set_friend_hidden(uuid, boolean) from public;
grant execute on function public.set_friend_note(uuid, text) to authenticated;
grant execute on function public.set_friend_hidden(uuid, boolean) to authenticated;

create or replace function public.list_friends(include_hidden boolean default false)
returns table (
  member_id uuid,
  display_name text,
  effective_name text,
  avatar_url text,
  major text,
  grad_year integer,
  shared_courses jsonb,
  hidden boolean,
  send_status text,
  conversation_id uuid
)
language sql
security definer
stable
set search_path = ''
as $$
  with mine as (
    select
      friendship.pair_low,
      friendship.pair_high,
      case
        when friendship.pair_low = auth.uid() then friendship.pair_high
        else friendship.pair_low
      end as other_id
    from public.friendships friendship
    where friendship.active
      and auth.uid() in (friendship.pair_low, friendship.pair_high)
      and public.has_completed_onboarding()
  )
  select
    mine.other_id,
    profile.display_name,
    coalesce(preference.note, profile.display_name),
    profile.avatar_url,
    profile.major,
    profile.grad_year,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', course.id,
          'code', course.code,
          'title', course.title
        ) order by course.code, course.id
      )
      from public.course_members my_membership
      join public.course_members their_membership
        on their_membership.course_id = my_membership.course_id
       and their_membership.user_id = mine.other_id
      join public.courses course on course.id = my_membership.course_id
      join public.school_term_settings term
        on term.school_id = course.school_id
       and term.current_term = course.term
      where my_membership.user_id = auth.uid()
    ), '[]'::jsonb),
    coalesce(preference.hidden, false),
    case
      when public.members_are_blocked(auth.uid(), mine.other_id) then 'blocked'
      else 'allowed'
    end,
    direct.conversation_id
  from mine
  join public.profiles profile on profile.id = mine.other_id
  left join public.friend_preferences preference
    on preference.pair_low = mine.pair_low
   and preference.pair_high = mine.pair_high
   and preference.owner_id = auth.uid()
  left join public.direct_conversations direct
    on direct.member_low = mine.pair_low
   and direct.member_high = mine.pair_high
  where include_hidden or not coalesce(preference.hidden, false)
  order by coalesce(preference.note, profile.display_name), mine.other_id;
$$;

revoke execute on function public.list_friends(boolean) from public;
grant execute on function public.list_friends(boolean) to authenticated;

create or replace function public.list_friend_requests()
returns table (
  request_id uuid,
  direction text,
  other_member_id uuid,
  display_name text,
  avatar_url text,
  message text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    request.id,
    case when request.recipient_id = auth.uid() then 'incoming' else 'outgoing' end,
    case
      when request.recipient_id = auth.uid() then request.requester_id
      else request.recipient_id
    end,
    profile.display_name,
    profile.avatar_url,
    request.message,
    case
      when request.status = 'pending' and request.expires_at <= now() then 'expired'
      else request.status
    end,
    request.created_at,
    request.expires_at,
    request.resolved_at
  from public.friend_requests request
  left join public.profiles profile on profile.id = case
    when request.recipient_id = auth.uid() then request.requester_id
    else request.recipient_id
  end
  where public.has_completed_onboarding()
    and auth.uid() in (request.requester_id, request.recipient_id)
  order by request.created_at desc, request.id desc;
$$;

revoke execute on function public.list_friend_requests() from public;
grant execute on function public.list_friend_requests() to authenticated;

-- RLS controls rows, not columns. Direct table reads therefore expose only the
-- limited Profile used by course-member views; full own/friend views go through
-- dedicated security-definer functions.
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url) on public.profiles to authenticated;

create or replace function public.get_own_profile()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  major text,
  grad_year integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.major,
    profile.grad_year,
    profile.created_at,
    profile.updated_at
  from public.profiles profile
  where profile.id = auth.uid();
$$;

revoke execute on function public.get_own_profile() from public;
grant execute on function public.get_own_profile() to authenticated;

alter table public.messages
  add column source_friend_request_id uuid
    references public.friend_requests(id) on delete set null;

create unique index messages_unique_friend_request_source
  on public.messages (source_friend_request_id)
  where source_friend_request_id is not null;

create or replace function public.respond_to_friend_request(
  target_request_id uuid,
  decision text
)
returns table (result_status text, conversation_id uuid)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_request public.friend_requests%rowtype;
  direct_conversation_id uuid;
  now_value timestamptz := clock_timestamp();
begin
  if not public.has_completed_onboarding() then
    return query select 'onboarding_required'::text, null::uuid;
    return;
  end if;

  if decision not in ('accept', 'reject') then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select request.* into target_request
  from public.friend_requests request
  where request.id = target_request_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if target_request.recipient_id is distinct from actor then
    return query select 'not_recipient'::text, null::uuid;
    return;
  end if;

  if target_request.status = 'accepted' then
    select direct.conversation_id into direct_conversation_id
    from public.direct_conversations direct
    where direct.member_low = target_request.pair_low
      and direct.member_high = target_request.pair_high;
    return query select 'accepted'::text, direct_conversation_id;
    return;
  end if;

  if target_request.status <> 'pending' then
    return query select target_request.status, null::uuid;
    return;
  end if;

  if target_request.expires_at <= now_value then
    update public.friend_requests
    set status = 'expired', resolved_at = now_value
    where id = target_request.id;
    delete from public.friend_request_active_pairs
    where request_id = target_request.id;
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.member_blocks block
    where (block.blocker_id = target_request.pair_low
       and block.blocked_id = target_request.pair_high)
       or (block.blocker_id = target_request.pair_high
       and block.blocked_id = target_request.pair_low)
  ) then
    return query select 'blocked'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.member_accounts requester
    join public.member_accounts recipient
      on recipient.user_id = target_request.recipient_id
     and recipient.school_id = requester.school_id
    join public.profiles requester_profile
      on requester_profile.id = requester.user_id
     and char_length(trim(requester_profile.display_name)) between 1 and 15
    join public.profiles recipient_profile
      on recipient_profile.id = recipient.user_id
     and char_length(trim(recipient_profile.display_name)) between 1 and 15
    where requester.user_id = target_request.requester_id
  ) then
    return query select 'not_available'::text, null::uuid;
    return;
  end if;

  if decision = 'reject' then
    update public.friend_requests
    set status = 'rejected', resolved_at = now_value
    where id = target_request.id;
    delete from public.friend_request_active_pairs
    where request_id = target_request.id;
    return query select 'rejected'::text, null::uuid;
    return;
  end if;

  insert into public.friendships
    (pair_low, pair_high, active, created_at, reactivated_at, ended_at)
  values (
    target_request.pair_low, target_request.pair_high,
    true, now_value, null, null
  )
  on conflict (pair_low, pair_high) do update
  set active = true,
      reactivated_at = now_value,
      ended_at = null;

  select direct.conversation_id into direct_conversation_id
  from public.direct_conversations direct
  where direct.member_low = target_request.pair_low
    and direct.member_high = target_request.pair_high;

  if direct_conversation_id is null then
    insert into public.conversations (kind)
    values ('direct') returning id into direct_conversation_id;
    insert into public.direct_conversations
      (conversation_id, member_low, member_high)
    values (
      direct_conversation_id,
      target_request.pair_low,
      target_request.pair_high
    );
  end if;

  insert into public.messages (
    conversation_id, sender_id, body, created_at, source_friend_request_id
  ) values (
    direct_conversation_id,
    target_request.requester_id,
    target_request.message,
    target_request.created_at,
    target_request.id
  ) on conflict (source_friend_request_id)
    where source_friend_request_id is not null
    do nothing;

  update public.friend_requests
  set status = 'accepted', resolved_at = now_value
  where id = target_request.id;
  delete from public.friend_request_active_pairs
  where request_id = target_request.id;

  return query select 'accepted'::text, direct_conversation_id;
end;
$$;

revoke execute on function public.respond_to_friend_request(uuid, text) from public;
grant execute on function public.respond_to_friend_request(uuid, text) to authenticated;

create or replace function public.find_member_by_email(candidate_email text)
returns table (
  result_status text,
  member_id uuid,
  display_name text,
  avatar_url text,
  major text,
  grad_year integer,
  shared_courses jsonb,
  relationship_status text,
  incoming_request_id uuid
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  if not public.has_completed_onboarding() then
    return query select
      'onboarding_required'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::uuid;
    return;
  end if;

  if not public.consume_friend_rate_limit('member_search') then
    return query select
      'rate_limited'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::uuid;
    return;
  end if;

  return query
  select
    'found'::text,
    target.user_id,
    profile.display_name,
    profile.avatar_url,
    case when exists (
      select 1 from public.friendships friendship
      where friendship.pair_low = least(auth.uid(), target.user_id)
        and friendship.pair_high = greatest(auth.uid(), target.user_id)
        and friendship.active
    ) then profile.major else null end::text,
    case when exists (
      select 1 from public.friendships friendship
      where friendship.pair_low = least(auth.uid(), target.user_id)
        and friendship.pair_high = greatest(auth.uid(), target.user_id)
        and friendship.active
    ) then profile.grad_year else null end::integer,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', course.id,
          'code', course.code,
          'title', course.title
        )
        order by course.code, course.id
      )
      from public.course_members mine
      join public.course_members theirs
        on theirs.course_id = mine.course_id
       and theirs.user_id = target.user_id
      join public.courses course on course.id = mine.course_id
      join public.school_term_settings term
        on term.school_id = course.school_id
       and term.current_term = course.term
      where mine.user_id = auth.uid()
    ), '[]'::jsonb),
    public.friend_relationship_status(target.user_id),
    (
      select request.id
      from public.friend_request_active_pairs active
      join public.friend_requests request on request.id = active.request_id
      where active.pair_low = least(auth.uid(), target.user_id)
        and active.pair_high = greatest(auth.uid(), target.user_id)
        and request.recipient_id = auth.uid()
        and request.status = 'pending'
        and request.expires_at > now()
    )
  from auth.users auth_user
  join public.member_accounts target on target.user_id = auth_user.id
  join public.profiles profile on profile.id = target.user_id
  where public.has_completed_onboarding()
    and lower(trim(auth_user.email)) = lower(trim(candidate_email))
    and target.school_id = public.current_school_id()
    and target.user_id <> auth.uid();
  if not found then
    return query select
      'not_found'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::uuid;
  end if;
end;
$$;

revoke execute on function public.find_member_by_email(text) from public;
grant execute on function public.find_member_by_email(text) to authenticated;

commit;
