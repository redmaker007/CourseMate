begin;

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
  if exists (
    select 1 from public.friendships friendship
    where friendship.pair_low = low_member
      and friendship.pair_high = high_member
      and friendship.active
  ) then return 'friend'; end if;
  if public.members_are_blocked(actor, target_member_id) then return 'blocked'; end if;

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

create function public.list_course_member_relationships(target_course_id uuid)
returns table (
  member_id uuid,
  relationship_status text,
  restriction_status text,
  send_status text,
  conversation_id uuid
)
language sql
security definer
stable
set search_path = ''
as $$
  with authorized as (
    select 1
    from public.courses course
    join public.course_members membership
      on membership.course_id = course.id
     and membership.user_id = auth.uid()
    where course.id = target_course_id
      and course.school_id = public.current_school_id()
      and public.has_completed_onboarding()
  ), facts as (
    select
      member.user_id as member_id,
      friendship.active as active_friendship,
      request.requester_id,
      request.recipient_id,
      exists (
        select 1
        from public.member_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = member.user_id)
           or (block.blocker_id = member.user_id and block.blocked_id = auth.uid())
      ) as restricted,
      direct.conversation_id
    from authorized
    join public.course_members member on member.course_id = target_course_id
    left join public.friendships friendship
      on friendship.pair_low = least(auth.uid(), member.user_id)
     and friendship.pair_high = greatest(auth.uid(), member.user_id)
    left join public.friend_request_active_pairs active_request
      on active_request.pair_low = least(auth.uid(), member.user_id)
     and active_request.pair_high = greatest(auth.uid(), member.user_id)
    left join public.friend_requests request
      on request.id = active_request.request_id
     and request.status = 'pending'
     and request.expires_at > now()
    left join public.direct_conversations direct
      on direct.member_low = least(auth.uid(), member.user_id)
     and direct.member_high = greatest(auth.uid(), member.user_id)
    where member.user_id <> auth.uid()
  )
  select
    member_id,
    case
      when active_friendship then 'friend'
      when requester_id = auth.uid() then 'outgoing_request'
      when recipient_id = auth.uid() then 'incoming_request'
      else 'none'
    end,
    case when restricted then 'blocked' else 'none' end,
    case
      when active_friendship is not true or conversation_id is null then null
      when restricted then 'blocked'
      when public.can_send_to_direct_conversation(conversation_id) then 'allowed'
      else 'readonly'
    end,
    case when active_friendship then conversation_id else null end
  from facts
  order by member_id;
$$;

revoke all on function public.friend_relationship_status(uuid) from public, anon, authenticated;
grant execute on function public.friend_relationship_status(uuid) to authenticated;
revoke all on function public.list_course_member_relationships(uuid) from public, anon, authenticated;
grant execute on function public.list_course_member_relationships(uuid) to authenticated;

commit;
