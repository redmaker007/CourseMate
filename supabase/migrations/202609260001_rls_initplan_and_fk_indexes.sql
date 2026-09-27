-- 将同一次查询中不随行变化的 RLS 身份值改为 InitPlan，并为未覆盖的外键补齐索引。
-- 权限条件本身不变；逐行判断函数仍按每一行执行。
begin;

alter policy behavior_reports_select_own on public.behavior_reports
  using (
    (select public.has_completed_onboarding())
    and reporter_id = (select auth.uid())
  );

alter policy course_catalog_select_own_school on public.course_catalog
  using (
    (select public.has_completed_onboarding())
    and school_id = (select public.current_school_id())
  );

alter policy course_members_select on public.course_members
  using (
    (select public.has_completed_onboarding())
    and (
      user_id = (select auth.uid())
      or public.is_course_member(course_id)
    )
  );

alter policy course_members_insert_self on public.course_members
  with check (
    (select public.has_completed_onboarding())
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.courses c
      join public.school_term_settings terms on terms.school_id = c.school_id
      where c.id = course_id
        and c.school_id = (select public.current_school_id())
        and c.term = terms.current_term
    )
  );

alter policy course_members_delete_self on public.course_members
  using (
    (select public.has_completed_onboarding())
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.courses c
      join public.school_term_settings terms on terms.school_id = c.school_id
      where c.id = course_id
        and c.school_id = (select public.current_school_id())
        and c.term = terms.current_term
    )
  );

alter policy courses_select_own_school on public.courses
  using (
    (select public.has_completed_onboarding())
    and school_id = (select public.current_school_id())
  );

alter policy friend_preferences_select_owner on public.friend_preferences
  using (
    (select public.has_completed_onboarding())
    and owner_id = (select auth.uid())
  );

alter policy friend_requests_select_participant on public.friend_requests
  using (
    (select public.has_completed_onboarding())
    and (
      (select auth.uid()) = requester_id
      or (select auth.uid()) = recipient_id
    )
  );

alter policy friendships_select_participant on public.friendships
  using (
    (select public.has_completed_onboarding())
    and (
      (select auth.uid()) = pair_low
      or (select auth.uid()) = pair_high
    )
  );

alter policy member_blocks_select_owner on public.member_blocks
  using (
    (select public.has_completed_onboarding())
    and blocker_id = (select auth.uid())
  );

alter policy profiles_insert_self on public.profiles
  with check (id = (select auth.uid()));

alter policy profiles_select_self_or_classmate on public.profiles
  using (
    id = (select auth.uid())
    or (
      (select public.has_completed_onboarding())
      and public.shares_course_with(id)
    )
  );

alter policy profiles_update_self on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy school_term_settings_select_own_school on public.school_term_settings
  using (
    (select public.has_completed_onboarding())
    and school_id = (select public.current_school_id())
  );

create index if not exists admin_audit_log_actor_id_idx
  on public.admin_audit_log (actor_id);

create index if not exists admin_school_test_context_school_id_idx
  on public.admin_school_test_context (school_id);

create index if not exists courses_created_by_idx
  on public.courses (created_by);

create index if not exists direct_conversations_member_high_idx
  on public.direct_conversations (member_high);

create index if not exists direct_message_cleanup_eligibility_message_idx
  on public.direct_message_cleanup_eligibility (conversation_id, message_id);

create index if not exists friend_preferences_owner_id_idx
  on public.friend_preferences (owner_id);

create index if not exists friend_rate_limit_buckets_action_kind_idx
  on public.friend_rate_limit_buckets (action_kind);

create index if not exists friend_requests_recipient_id_idx
  on public.friend_requests (recipient_id);

create index if not exists friend_requests_requester_id_idx
  on public.friend_requests (requester_id);

create index if not exists friendships_pair_high_idx
  on public.friendships (pair_high);

create index if not exists member_accounts_school_id_idx
  on public.member_accounts (school_id);

create index if not exists member_blocks_blocked_id_idx
  on public.member_blocks (blocked_id);

create index if not exists platform_roles_granted_by_idx
  on public.platform_roles (granted_by);

commit;
