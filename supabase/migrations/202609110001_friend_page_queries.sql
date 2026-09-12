create or replace function public.list_blocked_members()
returns table (
  member_id uuid,
  display_name text,
  avatar_url text,
  active_friendship boolean,
  conversation_id uuid
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.has_completed_onboarding() then
    return;
  end if;

  return query
  select
    block.blocked_id,
    profile.display_name,
    profile.avatar_url,
    coalesce(friendship.active, false),
    direct.conversation_id
  from public.member_blocks block
  join public.profiles profile on profile.id = block.blocked_id
  left join public.friendships friendship
    on friendship.pair_low = least(actor, block.blocked_id)
   and friendship.pair_high = greatest(actor, block.blocked_id)
  left join public.direct_conversations direct
    on direct.member_low = least(actor, block.blocked_id)
   and direct.member_high = greatest(actor, block.blocked_id)
  where block.blocker_id = actor
  order by lower(profile.display_name), block.blocked_id;
end;
$$;

revoke execute on function public.list_blocked_members() from public, anon;
grant execute on function public.list_blocked_members() to authenticated;
