create or replace function public.member_block_status(target_member_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.member_blocks
      where blocker_id = auth.uid() and blocked_id = target_member_id
    ) and exists (
      select 1 from public.member_blocks
      where blocker_id = target_member_id and blocked_id = auth.uid()
    ) then 'mutual'
    when exists (
      select 1 from public.member_blocks
      where blocker_id = auth.uid() and blocked_id = target_member_id
    ) then 'blocked_by_me'
    when exists (
      select 1 from public.member_blocks
      where blocker_id = target_member_id and blocked_id = auth.uid()
    ) then 'blocked_by_other'
    else 'none'
  end;
$$;

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
  if not found then return 'not_found'; end if;
  return 'cleared';
end;
$$;

drop function public.find_member_by_email(text);

create function public.find_member_by_email(candidate_email text)
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
    and target.school_id = public.current_school_id()
    and target.user_id <> auth.uid();
  if not found then
    return query select
      'not_found'::text, null::uuid, null::text, null::text,
      null::text, null::integer, null::jsonb, null::text, null::text, null::uuid;
  end if;
end;
$$;

drop function public.list_friends(boolean);

create function public.list_friends(include_hidden boolean default false)
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

revoke execute on function public.member_block_status(uuid) from public, anon;
revoke execute on function public.find_member_by_email(text) from public, anon;
revoke execute on function public.list_friends(boolean) from public, anon;
grant execute on function public.member_block_status(uuid) to authenticated;
grant execute on function public.find_member_by_email(text) to authenticated;
grant execute on function public.list_friends(boolean) to authenticated;
