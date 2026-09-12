-- Friend direct messaging, private read state, personal clearing, and unread data.
begin;

alter table public.conversation_members
  add column cleared_at timestamptz;

update public.conversation_members
set cleared_at = now()
where cleared_through_message_id is not null;

alter table public.conversation_members
  add constraint conversation_members_clear_timestamp_check check (
    (cleared_through_message_id is null and cleared_at is null)
    or (cleared_through_message_id is not null and cleared_at is not null)
  );

alter table public.messages replica identity full;

create or replace function public.can_access_direct_conversation(
  target_conversation uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.has_completed_onboarding()
    and exists (
      select 1
      from public.conversations conversation
      join public.direct_conversations direct
        on direct.conversation_id = conversation.id
      join public.conversation_members member
        on member.conversation_id = conversation.id
      where conversation.id = target_conversation
        and conversation.kind = 'direct'
        and member.user_id = auth.uid()
    );
$$;

revoke execute on function public.can_access_direct_conversation(uuid) from public;
grant execute on function public.can_access_direct_conversation(uuid) to authenticated;

create or replace function public.can_send_to_direct_conversation(
  target_conversation uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.can_access_direct_conversation(target_conversation)
    and exists (
      select 1
      from public.direct_conversations direct
      join public.friendships friendship
        on friendship.pair_low = direct.member_low
       and friendship.pair_high = direct.member_high
       and friendship.active
      where direct.conversation_id = target_conversation
        and auth.uid() in (direct.member_low, direct.member_high)
        and not public.members_are_blocked(direct.member_low, direct.member_high)
    );
$$;

revoke execute on function public.can_send_to_direct_conversation(uuid) from public;
grant execute on function public.can_send_to_direct_conversation(uuid) to authenticated;

create policy conversations_select_direct_member
  on public.conversations
  for select to authenticated
  using (public.can_access_direct_conversation(id));

create policy direct_conversations_select_member
  on public.direct_conversations
  for select to authenticated
  using (public.can_access_direct_conversation(conversation_id));

grant select on public.direct_conversations to authenticated;

-- Direct members may read history after a block or friendship removal. Send
-- eligibility is intentionally stricter and is checked separately above.
create policy messages_select_direct_member
  on public.messages
  for select to authenticated
  using (
    deleted_at is null
    and public.can_access_direct_conversation(conversation_id)
  );

create or replace function public.send_direct_message(
  target_conversation_id uuid,
  message_body text
)
returns table (result_status text, message_id bigint)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_body text := trim(message_body);
  created_message_id bigint;
begin
  if not public.has_completed_onboarding() then
    return query select 'onboarding_required'::text, null::bigint;
    return;
  end if;

  if not public.can_access_direct_conversation(target_conversation_id) then
    return query select 'not_available'::text, null::bigint;
    return;
  end if;

  if normalized_body is null
     or char_length(normalized_body) not between 1 and 4000 then
    return query select 'invalid_body'::text, null::bigint;
    return;
  end if;

  if not public.can_send_to_direct_conversation(target_conversation_id) then
    return query select 'not_allowed'::text, null::bigint;
    return;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (target_conversation_id, actor, normalized_body)
  returning id into created_message_id;

  return query select 'sent'::text, created_message_id;
end;
$$;

revoke execute on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

create or replace function public.list_direct_messages(
  target_conversation_id uuid,
  cursor_direction text default 'before',
  cursor_message_id bigint default null,
  page_size integer default 50
)
returns table (
  message_id bigint,
  conversation_id uuid,
  sender_id uuid,
  sender_display_name text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  clear_position bigint;
begin
  if not public.can_access_direct_conversation(target_conversation_id) then
    return;
  end if;
  if cursor_direction is null
     or cursor_direction not in ('before', 'after')
     or page_size is null
     or page_size not between 1 and 200
     or (cursor_message_id is not null and cursor_message_id < 1) then
    raise exception 'invalid direct message cursor';
  end if;

  select member.cleared_through_message_id into clear_position
  from public.conversation_members member
  where member.conversation_id = target_conversation_id
    and member.user_id = actor;

  if cursor_direction = 'after' then
    return query
      select message.id, message.conversation_id, message.sender_id,
        coalesce(profile.display_name, 'Deleted member'),
        message.body, message.created_at
      from public.messages message
      left join public.profiles profile on profile.id = message.sender_id
      where message.conversation_id = target_conversation_id
        and message.deleted_at is null
        and message.id > coalesce(clear_position, 0)
        and message.id > coalesce(cursor_message_id, 0)
      order by message.id asc
      limit page_size;
  else
    return query
      select page.id, page.conversation_id, page.sender_id,
        page.sender_display_name, page.body, page.created_at
      from (
        select message.id, message.conversation_id, message.sender_id,
          coalesce(profile.display_name, 'Deleted member') as sender_display_name,
          message.body, message.created_at
        from public.messages message
        left join public.profiles profile on profile.id = message.sender_id
        where message.conversation_id = target_conversation_id
          and message.deleted_at is null
          and message.id > coalesce(clear_position, 0)
          and (cursor_message_id is null or message.id < cursor_message_id)
        order by message.id desc
        limit page_size
      ) page
      order by page.id asc;
  end if;
end;
$$;

revoke execute on function public.list_direct_messages(uuid, text, bigint, integer)
from public;
grant execute on function public.list_direct_messages(uuid, text, bigint, integer)
to authenticated;

create or replace function public.mark_direct_conversation_read(
  target_conversation_id uuid,
  through_message_id bigint
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  if not public.can_access_direct_conversation(target_conversation_id) then
    return 'not_available';
  end if;
  if not exists (
    select 1 from public.messages message
    where message.conversation_id = target_conversation_id
      and message.id = through_message_id
      and message.deleted_at is null
  ) then
    return 'invalid_cursor';
  end if;

  update public.conversation_members member
  set last_read_message_id = greatest(
    coalesce(member.last_read_message_id, 0), through_message_id
  )
  where member.conversation_id = target_conversation_id
    and member.user_id = auth.uid();
  return 'updated';
end;
$$;

revoke execute on function public.mark_direct_conversation_read(uuid, bigint)
from public;
grant execute on function public.mark_direct_conversation_read(uuid, bigint)
to authenticated;

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
begin
  if not public.can_access_direct_conversation(target_conversation_id) then
    return 'not_available';
  end if;
  if not exists (
    select 1 from public.messages message
    where message.conversation_id = target_conversation_id
      and message.id = through_message_id
  ) then
    return 'invalid_cursor';
  end if;

  update public.conversation_members member
  set cleared_through_message_id = through_message_id,
      cleared_at = clock_timestamp()
  where member.conversation_id = target_conversation_id
    and member.user_id = auth.uid()
    and through_message_id > coalesce(member.cleared_through_message_id, 0);
  return 'updated';
end;
$$;

revoke execute on function public.clear_direct_conversation(uuid, bigint)
from public;
grant execute on function public.clear_direct_conversation(uuid, bigint)
to authenticated;

create or replace function public.list_direct_conversation_unread(
  include_hidden boolean default false
)
returns table (conversation_id uuid, unread_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select member.conversation_id, count(message.id)::bigint
  from public.conversation_members member
  join public.direct_conversations direct
    on direct.conversation_id = member.conversation_id
  left join public.friend_preferences preference
    on preference.pair_low = direct.member_low
   and preference.pair_high = direct.member_high
   and preference.owner_id = auth.uid()
  join public.messages message
    on message.conversation_id = member.conversation_id
   and message.id > greatest(
     coalesce(member.last_read_message_id, 0),
     coalesce(member.cleared_through_message_id, 0)
   )
   and message.deleted_at is null
   and message.sender_id is distinct from auth.uid()
  where member.user_id = auth.uid()
    and public.can_access_direct_conversation(member.conversation_id)
    and (include_hidden or not coalesce(preference.hidden, false))
  group by member.conversation_id
  order by member.conversation_id;
$$;

revoke execute on function public.list_direct_conversation_unread(boolean)
from public;
grant execute on function public.list_direct_conversation_unread(boolean)
to authenticated;

create or replace function public.get_direct_unread_counts()
returns table (visible_unread bigint, hidden_unread bigint)
language sql
security definer
stable
set search_path = ''
as $$
  with member_conversations as (
    select member.conversation_id,
      greatest(
        coalesce(member.last_read_message_id, 0),
        coalesce(member.cleared_through_message_id, 0)
      ) as seen_through,
      coalesce(preference.hidden, false) as hidden
    from public.conversation_members member
    join public.direct_conversations direct
      on direct.conversation_id = member.conversation_id
    left join public.friend_preferences preference
      on preference.pair_low = direct.member_low
     and preference.pair_high = direct.member_high
     and preference.owner_id = auth.uid()
    where member.user_id = auth.uid()
      and public.can_access_direct_conversation(member.conversation_id)
  ), unread as (
    select membership.hidden, count(message.id)::bigint as message_count
    from member_conversations membership
    join public.messages message
      on message.conversation_id = membership.conversation_id
     and message.id > membership.seen_through
     and message.deleted_at is null
     and message.sender_id is distinct from auth.uid()
    group by membership.hidden
  )
  select
    coalesce(sum(message_count) filter (where not hidden), 0)::bigint,
    coalesce(sum(message_count) filter (where hidden), 0)::bigint
  from unread;
$$;

revoke execute on function public.get_direct_unread_counts() from public;
grant execute on function public.get_direct_unread_counts() to authenticated;

commit;
