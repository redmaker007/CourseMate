-- Minimal authorized metadata required by the one-to-one chat page.
begin;

create or replace function public.get_direct_conversation_view(
  target_conversation_id uuid
)
returns table (
  conversation_id uuid,
  other_member_id uuid,
  other_display_name text,
  send_status text,
  hidden boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  with authorized as (
    select direct.conversation_id, direct.member_low, direct.member_high,
      case
        when direct.member_low = auth.uid() then direct.member_high
        when direct.member_high = auth.uid() then direct.member_low
      end as other_member_id
    from public.direct_conversations direct
    where direct.conversation_id = target_conversation_id
      and public.can_access_direct_conversation(direct.conversation_id)
  )
  select authorized.conversation_id,
    authorized.other_member_id,
    coalesce(profile.display_name, 'Deleted member'),
    case
      when public.members_are_blocked(
        authorized.member_low,
        authorized.member_high
      ) then 'blocked'
      when public.can_send_to_direct_conversation(authorized.conversation_id)
        then 'allowed'
      else 'readonly'
    end,
    coalesce(preference.hidden, false)
  from authorized
  left join public.profiles profile on profile.id = authorized.other_member_id
  left join public.friend_preferences preference
    on preference.pair_low = authorized.member_low
   and preference.pair_high = authorized.member_high
   and preference.owner_id = auth.uid();
$$;

revoke execute on function public.get_direct_conversation_view(uuid) from public;
grant execute on function public.get_direct_conversation_view(uuid) to authenticated;

commit;
