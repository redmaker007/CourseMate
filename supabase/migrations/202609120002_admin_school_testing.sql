-- 管理员跨校测试：登录绑定不变，业务学校由受控上下文决定。
-- 切换影响同一账号的所有会话；课程成员和社交历史保留，读写权限实时重算。
begin;

create table public.admin_school_test_context (
  user_id uuid primary key references public.platform_roles(user_id) on delete cascade,
  school_id text not null references public.schools(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.admin_school_test_context enable row level security;
revoke all on public.admin_school_test_context from public, anon, authenticated;

-- 内部函数，不提供任意成员学校的查询接口。
create function public.effective_member_school_id(target_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(test.school_id, member.school_id)
  from public.member_accounts member
  left join (
    select context.user_id, context.school_id
    from public.admin_school_test_context context
    join public.platform_roles staff on staff.user_id = context.user_id
      and staff.role in ('owner', 'admin')
    join public.schools school on school.id = context.school_id and school.enabled
  ) test on test.user_id = member.user_id
  where member.user_id = target_user;
$$;
revoke all on function public.effective_member_school_id(uuid) from public, anon, authenticated;

create or replace function public.current_school_id()
returns text language sql stable security definer set search_path = '' as $$
  select public.effective_member_school_id(auth.uid());
$$;
revoke all on function public.current_school_id() from public, anon, authenticated;
grant execute on function public.current_school_id() to authenticated;

create function public.admin_set_test_school(target_school text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.require_platform_role('admin');
  chosen text := nullif(trim(target_school), '');
  home_school text;
  previous_school text := public.current_school_id();
begin
  if not public.has_completed_onboarding() then
    raise exception '请先完成个人资料。' using errcode = '22023';
  end if;
  -- 与撤销身份串行，避免撤权时插入上下文。
  perform 1 from public.platform_roles where user_id = actor for update;
  perform public.require_platform_role('admin');
  select school_id into home_school from public.member_accounts where user_id = actor;
  if chosen = home_school then chosen := null; end if;
  if chosen is not null and not exists (
    select 1 from public.schools where id = chosen and enabled
  ) then
    raise exception '请选择已开放的学校。' using errcode = '22023';
  end if;
  if chosen is null then
    delete from public.admin_school_test_context where user_id = actor;
  else
    insert into public.admin_school_test_context (user_id, school_id)
    values (actor, chosen)
    on conflict (user_id) do update set school_id = excluded.school_id, updated_at = now();
  end if;
  perform public.write_admin_audit(actor, 'school.test_switch', coalesce(chosen, home_school),
    jsonb_build_object('from', previous_school, 'to', coalesce(chosen, home_school),
                      'home_school', home_school));
  return coalesce(chosen, home_school);
end;
$$;
revoke all on function public.admin_set_test_school(text) from public, anon, authenticated;
grant execute on function public.admin_set_test_school(text) to authenticated;

-- 关闭测试学校时清除上下文；重新开放不会悄悄恢复旧测试模式。
create function public.clear_disabled_school_test_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.enabled and not new.enabled then
    delete from public.admin_school_test_context where school_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_disabled_school_test_context() from public, anon, authenticated;
create trigger schools_clear_test_context after update of enabled on public.schools
for each row execute function public.clear_disabled_school_test_context();

-- 保留选课记录，但旧页面、直接 REST 和 Realtime 都必须通过当前学校检查。
create or replace function public.is_course_member(target_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_members member
    join public.courses course on course.id = member.course_id
    where member.course_id = target_course and member.user_id = auth.uid()
      and course.school_id = public.current_school_id()
  );
$$;

create or replace function public.shares_course_with(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_members mine
    join public.course_members theirs on theirs.course_id = mine.course_id
    join public.courses course on course.id = mine.course_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
      and course.school_id = public.current_school_id()
  );
$$;

create or replace function public.can_access_course_conversation(target_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_completed_onboarding() and exists (
    select 1 from public.course_conversations link
    join public.conversations conversation on conversation.id = link.conversation_id
    join public.conversation_members member on member.conversation_id = link.conversation_id
    join public.courses course on course.id = link.course_id
    where link.conversation_id = target_conversation and conversation.kind = 'course'
      and member.user_id = auth.uid() and course.school_id = public.current_school_id()
  );
$$;

-- 历史仍只对会话参与者可读；新私信要求双方当前在同一学校。
create or replace function public.can_send_to_direct_conversation(target_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_access_direct_conversation(target_conversation) and exists (
    select 1 from public.direct_conversations direct
    join public.friendships friendship on friendship.pair_low = direct.member_low
      and friendship.pair_high = direct.member_high and friendship.active
    where direct.conversation_id = target_conversation
      and auth.uid() in (direct.member_low, direct.member_high)
      and public.effective_member_school_id(direct.member_low)
        = public.effective_member_school_id(direct.member_high)
      and not public.members_are_blocked(direct.member_low, direct.member_high)
  );
$$;

revoke all on function public.is_course_member(uuid), public.shares_course_with(uuid),
  public.can_access_course_conversation(uuid), public.can_send_to_direct_conversation(uuid)
from public, anon, authenticated;
grant execute on function public.is_course_member(uuid), public.shares_course_with(uuid),
  public.can_access_course_conversation(uuid), public.can_send_to_direct_conversation(uuid)
to authenticated;

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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

  actor_school := public.current_school_id();
  select public.effective_member_school_id(account.user_id) into target_school
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

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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

  if decision = 'reject' then
    update public.friend_requests
    set status = 'rejected', resolved_at = now_value
    where id = target_request.id;
    delete from public.friend_request_active_pairs
    where request_id = target_request.id;
    return query select 'rejected'::text, null::uuid;
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
     and public.effective_member_school_id(recipient.user_id) = public.effective_member_school_id(requester.user_id)
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

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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
  -- 切校后仍能拉黑/解除已有联系，避免失去自我保护能力。
  if not (
    coalesce(public.effective_member_school_id(target_member_id) = public.current_school_id(), false)
    or exists (select 1 from public.member_blocks
      where blocker_id = actor and blocked_id = target_member_id)
    or exists (select 1 from public.friend_requests
      where pair_low = least(actor, target_member_id) and pair_high = greatest(actor, target_member_id))
    or exists (select 1 from public.direct_conversations
      where member_low = least(actor, target_member_id) and member_high = greatest(actor, target_member_id))
  ) then return 'not_available'; end if;

  if coalesce(requested_blocked, false) then
    insert into public.member_blocks (blocker_id, blocked_id)
    values (actor, target_member_id)
    on conflict (blocker_id, blocked_id) do nothing;
    return 'saved';
  end if;

  delete from public.member_blocks
  where blocker_id = actor and blocked_id = target_member_id;
  if not found then return 'not_found'; end if;
  return 'cleared';
end;
$$;

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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
  block_status text,
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
      null::text, null::integer, null::jsonb, null::text, null::text, null::uuid;
    return;
  end if;

  if not public.consume_friend_rate_limit('member_search') then
    return query select
      'rate_limited'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::text, null::uuid;
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
        and course.school_id = public.current_school_id()
    ), '[]'::jsonb),
    public.friend_relationship_status(target.user_id),
    public.member_block_status(target.user_id),
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
    and public.effective_member_school_id(target.user_id) = public.current_school_id()
    and target.user_id <> auth.uid();
  if not found then
    return query select
      'not_found'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::text, null::uuid;
  end if;
end;
$$;

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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
  block_status text,
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
        and course.school_id = public.current_school_id()
    ), '[]'::jsonb),
    coalesce(preference.hidden, false),
    case when block_status.value = 'none' then 'allowed' else 'blocked' end,
    block_status.value,
    direct.conversation_id
  from mine
  join public.profiles profile on profile.id = mine.other_id
  cross join lateral (
    select public.member_block_status(mine.other_id) as value
  ) block_status
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

-- 同步现有业务函数的学校边界；其余限流、幂等和权限规则保持。
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

revoke all on function public.send_friend_request(uuid, text), public.respond_to_friend_request(uuid, text),
  public.set_member_blocked(uuid, boolean), public.find_member_by_email(text), public.list_friends(boolean),
  public.create_behavior_report(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.send_friend_request(uuid, text), public.respond_to_friend_request(uuid, text),
  public.set_member_blocked(uuid, boolean), public.find_member_by_email(text), public.list_friends(boolean),
  public.create_behavior_report(text, text, text, text)
to authenticated;
commit;
