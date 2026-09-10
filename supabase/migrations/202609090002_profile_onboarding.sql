-- Profile onboarding
--
-- ADR-0004 keeps member_accounts separate from public profile data, but makes a
-- valid Profile mandatory before a member can use CourseMate business data.

-- Keep legacy 16–40 character names intact. A NOT VALID check still rejects
-- invalid new rows and updates, while allowing existing members to correct their
-- own value without a destructive migration-time truncation.
alter table public.profiles
  add constraint profiles_display_name_onboarding_check
  check (char_length(trim(display_name)) between 1 and 15) not valid;

comment on table public.profiles is
  'Public member profile. A valid 1–15 character display name is required before the main application can be used.';

create or replace function public.has_completed_onboarding()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and char_length(trim(display_name)) between 1 and 15
  );
$$;

revoke execute on function public.has_completed_onboarding() from public;
grant execute on function public.has_completed_onboarding() to authenticated;

-- A member must always be able to read and repair their own Profile. Reading
-- another member's Profile is part of the main application and therefore gated.
drop policy if exists profiles_select_self_or_classmate on public.profiles;
create policy profiles_select_self_or_classmate on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      public.has_completed_onboarding()
      and public.shares_course_with(id)
    )
  );

-- Existing business tables enforce onboarding at the database boundary. Future
-- feature migrations must include the same predicate in their RLS policies.
drop policy if exists courses_select_own_school on public.courses;
create policy courses_select_own_school on public.courses
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and school_id = public.current_school_id()
  );

drop policy if exists courses_insert_own_school on public.courses;
create policy courses_insert_own_school on public.courses
  for insert to authenticated
  with check (
    public.has_completed_onboarding()
    and school_id = public.current_school_id()
    and created_by = auth.uid()
  );

drop policy if exists course_members_select on public.course_members;
create policy course_members_select on public.course_members
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and (user_id = auth.uid() or public.is_course_member(course_id))
  );

drop policy if exists course_members_insert_self on public.course_members;
create policy course_members_insert_self on public.course_members
  for insert to authenticated
  with check (
    public.has_completed_onboarding()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.courses c
      where c.id = course_id
        and c.school_id = public.current_school_id()
    )
  );

drop policy if exists course_members_delete_self on public.course_members;
create policy course_members_delete_self on public.course_members
  for delete to authenticated
  using (
    public.has_completed_onboarding()
    and user_id = auth.uid()
  );

drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and public.is_course_member(course_id)
  );

drop policy if exists group_members_select_member on public.group_members;
create policy group_members_select_member on public.group_members
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and public.is_group_member(group_id)
  );

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and public.is_group_member(group_id)
    and deleted_at is null
  );

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (
    public.has_completed_onboarding()
    and sender_id = auth.uid()
    and public.is_group_member(group_id)
  );
