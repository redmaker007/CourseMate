-- One reliable send boundary for every conversation kind.

begin;

alter table public.messages
  add column client_message_id uuid;

create unique index messages_sender_client_message_idx
  on public.messages (sender_id, client_message_id)
  where sender_id is not null and client_message_id is not null;

create or replace function public.send_conversation_message(
  target_conversation_id uuid,
  message_body text,
  client_message_id uuid
)
returns table (
  result_status text,
  message_id bigint,
  conversation_id uuid,
  sender_id uuid,
  sender_display_name text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_body text := trim(message_body);
  conversation_kind text;
  stored_message_id bigint;
  stored_conversation_id uuid;
  stored_body text;
begin
  if actor is null or not public.has_completed_onboarding() then
    return query
      select 'onboarding_required'::text, null::bigint, null::uuid,
             null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if client_message_id is null then
    return query
      select 'invalid_request'::text, null::bigint, null::uuid,
             null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if normalized_body is null
     or char_length(normalized_body) not between 1 and 4000 then
    return query
      select 'invalid_body'::text, null::bigint, null::uuid,
             null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select conversation.kind into conversation_kind
  from public.conversations conversation
  where conversation.id = target_conversation_id;

  if conversation_kind = 'course' then
    if not public.can_send_to_course_conversation(target_conversation_id) then
      return query
        select 'not_available'::text, null::bigint, null::uuid,
               null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
  elsif conversation_kind = 'direct' then
    if not public.can_access_direct_conversation(target_conversation_id) then
      return query
        select 'not_available'::text, null::bigint, null::uuid,
               null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
    if not public.can_send_to_direct_conversation(target_conversation_id) then
      return query
        select 'not_allowed'::text, null::bigint, null::uuid,
               null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
  else
    return query
      select 'not_available'::text, null::bigint, null::uuid,
             null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select message.id, message.conversation_id, message.body
  into stored_message_id, stored_conversation_id, stored_body
  from public.messages message
  where message.sender_id = actor
    and message.client_message_id = send_conversation_message.client_message_id;

  if stored_message_id is not null
     and (stored_conversation_id is distinct from target_conversation_id
          or stored_body is distinct from normalized_body) then
    return query
      select 'idempotency_conflict'::text, null::bigint, null::uuid,
             null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if stored_message_id is null then
    insert into public.messages (
      conversation_id,
      sender_id,
      body,
      client_message_id
    )
    values (
      target_conversation_id,
      actor,
      normalized_body,
      client_message_id
    )
    on conflict do nothing
    returning messages.id into stored_message_id;

    if stored_message_id is null then
      select message.id, message.conversation_id, message.body
      into stored_message_id, stored_conversation_id, stored_body
      from public.messages message
      where message.sender_id = actor
        and message.client_message_id = send_conversation_message.client_message_id;

      if stored_conversation_id is distinct from target_conversation_id
         or stored_body is distinct from normalized_body then
        return query
          select 'idempotency_conflict'::text, null::bigint, null::uuid,
                 null::uuid, null::text, null::text, null::timestamptz;
        return;
      end if;
    end if;
  end if;

  return query
  select
    'sent'::text,
    message.id,
    message.conversation_id,
    message.sender_id,
    profile.display_name,
    message.body,
    message.created_at
  from public.messages message
  join public.profiles profile on profile.id = message.sender_id
  where message.id = stored_message_id;
end;
$$;

revoke execute on function public.send_conversation_message(uuid, text, uuid)
from public;
grant execute on function public.send_conversation_message(uuid, text, uuid)
to authenticated;

drop function public.send_direct_message(uuid, text);

create function public.send_direct_message(
  target_conversation_id uuid,
  message_body text,
  client_message_id uuid default gen_random_uuid()
)
returns table (result_status text, message_id bigint)
language sql
security definer
volatile
set search_path = ''
as $$
  select result.result_status, result.message_id
  from public.send_conversation_message(
    target_conversation_id,
    message_body,
    client_message_id
  ) result;
$$;

revoke execute on function public.send_direct_message(uuid, text, uuid)
from public;
grant execute on function public.send_direct_message(uuid, text, uuid)
to authenticated;

drop function public.list_direct_messages(uuid, text, bigint, integer);

create function public.list_direct_messages(
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
  created_at timestamptz,
  client_message_id uuid
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
        message.body, message.created_at, message.client_message_id
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
        page.sender_display_name, page.body, page.created_at,
        page.client_message_id
      from (
        select message.id, message.conversation_id, message.sender_id,
          coalesce(profile.display_name, 'Deleted member') as sender_display_name,
          message.body, message.created_at, message.client_message_id
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

commit;
