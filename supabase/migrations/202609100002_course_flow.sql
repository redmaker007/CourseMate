-- Real course flow and explicit academic-term lifecycle.

begin;

-- The product's supported-school configuration includes both launch schools.
-- This is authentication/catalog scope, not the external course catalog that
-- will replace the course adapter later.
insert into public.schools (id, name_zh, name_en, enabled)
values ('umich', '密歇根大学', 'University of Michigan', true)
on conflict (id) do nothing;

insert into public.school_email_domains (domain, school_id)
values ('umich.edu', 'umich')
on conflict (domain) do nothing;

create table public.school_term_settings (
  school_id text primary key references public.schools(id) on delete cascade,
  current_term text not null
    check (current_term ~ '^[0-9]{4}-(spring|summer|fall|winter)$'),
  updated_at timestamptz not null default now()
);

insert into public.school_term_settings (school_id, current_term)
select id, '2026-fall'
from public.schools
where id in ('uw-madison', 'umich');

alter table public.school_term_settings enable row level security;
revoke all on public.school_term_settings from anon, authenticated;
grant select on public.school_term_settings to authenticated;

create policy school_term_settings_select_own_school
  on public.school_term_settings
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and school_id = public.current_school_id()
  );

-- Course rows belong to the controlled catalog/import path. Members can search
-- and join existing rows but cannot create or mutate catalog data directly.
revoke insert, update, delete on public.courses from authenticated;
drop policy if exists courses_insert_own_school on public.courses;

-- Joining and leaving are current-term operations. Archived course membership
-- stays stable so history and the member list remain readable.
drop policy if exists course_members_insert_self on public.course_members;
create policy course_members_insert_self on public.course_members
  for insert to authenticated
  with check (
    public.has_completed_onboarding()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.courses c
      join public.school_term_settings terms on terms.school_id = c.school_id
      where c.id = course_id
        and c.school_id = public.current_school_id()
        and c.term = terms.current_term
    )
  );

drop policy if exists course_members_delete_self on public.course_members;
create policy course_members_delete_self on public.course_members
  for delete to authenticated
  using (
    public.has_completed_onboarding()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.courses c
      join public.school_term_settings terms on terms.school_id = c.school_id
      where c.id = course_id
        and c.school_id = public.current_school_id()
        and c.term = terms.current_term
    )
  );

-- New imported courses immediately receive the correct active/archive state.
create or replace function public.create_conversation_for_course()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_conversation_id uuid;
  configured_term text;
begin
  select current_term into configured_term
  from public.school_term_settings
  where school_id = new.school_id;

  insert into public.conversations (kind, archived_at)
  values (
    'course',
    case when new.term = configured_term then null else now() end
  )
  returning id into new_conversation_id;

  insert into public.course_conversations (conversation_id, course_id)
  values (new_conversation_id, new.id);
  return new;
end;
$$;

create or replace function public.sync_school_course_archives()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations conversations
  set archived_at = case
    when courses.term = new.current_term then null
    else coalesce(conversations.archived_at, now())
  end
  from public.course_conversations course_links
  join public.courses courses on courses.id = course_links.course_id
  where conversations.id = course_links.conversation_id
    and courses.school_id = new.school_id;
  return new;
end;
$$;

create trigger school_term_settings_sync_archives
  after insert or update of current_term on public.school_term_settings
  for each row execute function public.sync_school_course_archives();

-- A course owns its generated conversation. The foreign key points from the
-- link to the course, so deleting a controlled catalog row needs this explicit
-- cleanup to avoid leaving an unreachable conversation behind.
create or replace function public.delete_conversation_for_course()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations conversations
  using public.course_conversations course_links
  where course_links.course_id = old.id
    and conversations.id = course_links.conversation_id;
  return old;
end;
$$;

create trigger courses_delete_owned_conversation
  before delete on public.courses
  for each row execute function public.delete_conversation_for_course();

-- Apply the explicit current-term configuration to conversations that existed
-- before this migration.
update public.conversations conversations
set archived_at = case
  when courses.term = terms.current_term then null
  else coalesce(conversations.archived_at, now())
end
from public.course_conversations course_links
join public.courses courses on courses.id = course_links.course_id
join public.school_term_settings terms on terms.school_id = courses.school_id
where conversations.id = course_links.conversation_id;

commit;
