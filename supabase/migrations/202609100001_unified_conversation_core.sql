-- Unified conversation core
--
-- Migrate the existing course-group model in place. Course conversations reuse
-- group UUIDs and messages keep their identity values, so existing cursors and
-- references remain stable.

begin;

create temp table _legacy_conversation_messages on commit drop as
select id, group_id, sender_id, body, created_at, deleted_at
from public.messages;

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('course', 'direct', 'custom')),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table public.course_conversations (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  course_id uuid not null unique
    references public.courses(id) on delete cascade
);

-- Pair columns make the one-conversation-per-pair invariant enforceable without
-- depending on the order in which participants are supplied. They become null
-- when an account is deleted; deleting an account must never delete the shared
-- conversation or the remaining member's history.
create table public.direct_conversations (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  member_low uuid references public.member_accounts(user_id) on delete set null,
  member_high uuid references public.member_accounts(user_id) on delete set null,
  constraint direct_conversations_distinct_ordered_members check (
    member_low is null
    or member_high is null
    or member_low < member_high
  )
);

create unique index direct_conversations_unique_active_pair
  on public.direct_conversations (member_low, member_high)
  where member_low is not null and member_high is not null;

create table public.conversation_members (
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  user_id uuid not null
    references public.member_accounts(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_message_id bigint,
  cleared_through_message_id bigint,
  primary key (conversation_id, user_id),
  constraint conversation_members_read_position_positive check (
    last_read_message_id is null or last_read_message_id > 0
  ),
  constraint conversation_members_clear_position_positive check (
    cleared_through_message_id is null or cleared_through_message_id > 0
  )
);

create index conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);

insert into public.conversations (id, kind, created_at)
select id, 'course', created_at
from public.groups;

insert into public.course_conversations (conversation_id, course_id)
select id, course_id
from public.groups;

insert into public.conversation_members (conversation_id, user_id, joined_at)
select group_id, user_id, joined_at
from public.group_members;

drop policy if exists messages_select_member on public.messages;
drop policy if exists messages_insert_member on public.messages;
drop policy if exists groups_select_member on public.groups;
drop policy if exists group_members_select_member on public.group_members;

drop trigger if exists courses_auto_create_group on public.courses;
drop trigger if exists course_members_sync_group_insert on public.course_members;
drop trigger if exists course_members_sync_group_delete on public.course_members;
drop function if exists public.create_group_for_course();
drop function if exists public.sync_group_membership();
drop function if exists public.is_group_member(uuid);

alter table public.messages
  drop constraint messages_group_id_fkey;
alter table public.messages
  rename column group_id to conversation_id;
alter table public.messages
  add constraint messages_conversation_id_fkey
  foreign key (conversation_id)
  references public.conversations(id) on delete cascade;

drop index if exists public.messages_group_created_idx;
create index messages_conversation_cursor_idx
  on public.messages (conversation_id, id desc);
create unique index messages_conversation_identity_idx
  on public.messages (conversation_id, id);

alter table public.conversation_members
  add constraint conversation_members_last_read_message_fkey
  foreign key (conversation_id, last_read_message_id)
  references public.messages (conversation_id, id),
  add constraint conversation_members_cleared_message_fkey
  foreign key (conversation_id, cleared_through_message_id)
  references public.messages (conversation_id, id);

-- Abort the transaction before removing the old source tables if any identity,
-- association, timestamp or soft-deletion state changed during the migration.
do $$
begin
  if (select count(*) from public.groups)
     <> (select count(*) from public.course_conversations) then
    raise exception 'conversation migration failed: course conversation count mismatch';
  end if;

  if exists (
    select g.id, g.course_id
    from public.groups g
    except
    select cc.conversation_id, cc.course_id
    from public.course_conversations cc
  ) or exists (
    select cc.conversation_id, cc.course_id
    from public.course_conversations cc
    except
    select g.id, g.course_id
    from public.groups g
  ) then
    raise exception 'conversation migration failed: course association mismatch';
  end if;

  if exists (
    select id, group_id as conversation_id, sender_id, body, created_at, deleted_at
    from _legacy_conversation_messages
    except
    select id, conversation_id, sender_id, body, created_at, deleted_at
    from public.messages
  ) or exists (
    select id, conversation_id, sender_id, body, created_at, deleted_at
    from public.messages
    except
    select id, group_id as conversation_id, sender_id, body, created_at, deleted_at
    from _legacy_conversation_messages
  ) then
    raise exception 'conversation migration failed: message history mismatch';
  end if;

  if exists (
    select gm.group_id, gm.user_id, gm.joined_at
    from public.group_members gm
    except
    select cm.conversation_id, cm.user_id, cm.joined_at
    from public.conversation_members cm
  ) or exists (
    select cm.conversation_id, cm.user_id, cm.joined_at
    from public.conversation_members cm
    except
    select gm.group_id, gm.user_id, gm.joined_at
    from public.group_members gm
  ) then
    raise exception 'conversation migration failed: membership mismatch';
  end if;
end;
$$;

-- Imported databases may have explicit identity values. Advance the sequence so
-- the first post-migration message is always newer than the historical cursor.
do $$
declare
  highest_message_id bigint;
begin
  select max(id) into highest_message_id from public.messages;
  perform pg_catalog.setval(
    pg_get_serial_sequence('public.messages', 'id'),
    coalesce(highest_message_id, 1),
    highest_message_id is not null
  );
end;
$$;

drop table public.group_members;
drop table public.groups;

-- Course lifecycle now has a single source of truth.
create or replace function public.prevent_conversation_kind_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'conversation kind is immutable';
  end if;
  return new;
end;
$$;

create trigger conversations_keep_kind
  before update of kind on public.conversations
  for each row execute function public.prevent_conversation_kind_change();

create or replace function public.enforce_course_conversation_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations
    where id = new.conversation_id and kind = 'course'
  ) then
    raise exception 'course conversation relation requires kind course';
  end if;
  return new;
end;
$$;

create trigger course_conversations_enforce_kind
  before insert or update of conversation_id on public.course_conversations
  for each row execute function public.enforce_course_conversation_kind();

create or replace function public.create_conversation_for_course()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_conversation_id uuid;
begin
  insert into public.conversations (kind)
  values ('course')
  returning id into new_conversation_id;

  insert into public.course_conversations (conversation_id, course_id)
  values (new_conversation_id, new.id);
  return new;
end;
$$;

create trigger courses_auto_create_conversation
  after insert on public.courses
  for each row execute function public.create_conversation_for_course();

create or replace function public.sync_course_conversation_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation uuid;
begin
  if tg_op = 'INSERT' then
    select conversation_id into target_conversation
    from public.course_conversations
    where course_id = new.course_id;

    insert into public.conversation_members (conversation_id, user_id, joined_at)
    values (target_conversation, new.user_id, new.joined_at)
    on conflict do nothing;
    return new;
  end if;

  select conversation_id into target_conversation
  from public.course_conversations
  where course_id = old.course_id;

  delete from public.conversation_members
  where conversation_id = target_conversation and user_id = old.user_id;
  return old;
end;
$$;

create trigger course_members_sync_conversation_insert
  after insert on public.course_members
  for each row execute function public.sync_course_conversation_membership();

create trigger course_members_sync_conversation_delete
  after delete on public.course_members
  for each row execute function public.sync_course_conversation_membership();

create or replace function public.enforce_conversation_membership_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_kind text;
begin
  select kind into conversation_kind
  from public.conversations
  where id = new.conversation_id;

  if conversation_kind = 'course' and not exists (
    select 1
    from public.course_conversations cc
    join public.course_members cm on cm.course_id = cc.course_id
    where cc.conversation_id = new.conversation_id
      and cm.user_id = new.user_id
  ) then
    raise exception 'course conversation membership must come from course membership';
  end if;

  if conversation_kind = 'direct' and not exists (
    select 1
    from public.direct_conversations dc
    where dc.conversation_id = new.conversation_id
      and new.user_id in (dc.member_low, dc.member_high)
  ) then
    raise exception 'direct conversation membership must match its member pair';
  end if;

  return new;
end;
$$;

create trigger conversation_members_enforce_source
  before insert or update on public.conversation_members
  for each row execute function public.enforce_conversation_membership_source();

create or replace function public.register_direct_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_low is null or new.member_high is null then
    raise exception 'direct conversations require two active members';
  end if;

  if not exists (
    select 1 from public.conversations
    where id = new.conversation_id and kind = 'direct'
  ) then
    raise exception 'direct conversation relation requires kind direct';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values
    (new.conversation_id, new.member_low),
    (new.conversation_id, new.member_high);
  return new;
end;
$$;

create trigger direct_conversations_register_members
  after insert on public.direct_conversations
  for each row execute function public.register_direct_conversation_members();

comment on column public.messages.sender_id is
  'Sender account. Set to null when the account is deleted; message history remains as deleted-user content.';

alter table public.conversations enable row level security;
alter table public.course_conversations enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.conversation_members enable row level security;

revoke all on public.conversations from anon, authenticated;
revoke all on public.course_conversations from anon, authenticated;
revoke all on public.direct_conversations from anon, authenticated;
revoke all on public.conversation_members from anon, authenticated;

create or replace function public.can_access_course_conversation(
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
      from public.course_conversations cc
      join public.conversations c on c.id = cc.conversation_id
      join public.conversation_members cm
        on cm.conversation_id = cc.conversation_id
      where cc.conversation_id = target_conversation
        and c.kind = 'course'
        and cm.user_id = auth.uid()
    );
$$;

revoke execute on function public.can_access_course_conversation(uuid)
from public;
grant execute on function public.can_access_course_conversation(uuid)
to authenticated;

grant select on public.conversations to authenticated;
grant select on public.course_conversations to authenticated;
grant select on public.conversation_members to authenticated;

create policy conversations_select_course_member
  on public.conversations
  for select to authenticated
  using (public.can_access_course_conversation(id));

create policy course_conversations_select_member
  on public.course_conversations
  for select to authenticated
  using (public.can_access_course_conversation(conversation_id));

create policy conversation_members_select_course_member
  on public.conversation_members
  for select to authenticated
  using (public.can_access_course_conversation(conversation_id));

create or replace function public.can_send_to_course_conversation(
  target_conversation uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.can_access_course_conversation(target_conversation)
    and exists (
      select 1
      from public.conversations
      where id = target_conversation and archived_at is null
    );
$$;

revoke execute on function public.can_send_to_course_conversation(uuid)
from public;
grant execute on function public.can_send_to_course_conversation(uuid)
to authenticated;

create policy messages_select_course_member
  on public.messages
  for select to authenticated
  using (
    deleted_at is null
    and public.can_access_course_conversation(conversation_id)
  );

create policy messages_insert_active_course_member
  on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_send_to_course_conversation(conversation_id)
  );

commit;
