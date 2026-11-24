-- 停用（封禁）违规账号。2026-11-23 用户按推荐方案确认：
-- 1. 效果：被停用的成员什么都不能看、不能发。数据库层通过两个既有关口生效——
--    has_completed_onboarding() 与 current_school_id() 对停用成员分别返回 false／null，
--    依赖它们的 RLS、RPC、Realtime 全部关闭；get_member_context 新增 suspended，
--    让网页和 App 显示“账号已停用”而不是让用户去补资料。停用成员也不能改自己的资料。
-- 2. 已发内容：保留，由管理员按举报逐条删除（见 docs/runbooks/report-handling.md）。
-- 3. 注销：停用期间仍可永久注销（Apple 要求）。停用记录保存邮箱的 SHA-256 哈希（不存邮箱本身），
--    账号删除后记录仍在，Before User Created Hook 据此拒绝同一邮箱重新注册，直到解除停用。
-- 4. 操作：平台管理员调用 admin_suspend_member／admin_unsuspend_member（或按邮箱解除），
--    每次写审计日志。管理员不能停用自己、所有者，也不能停用其他管理员（只有所有者可以）。
begin;

create or replace function public.suspension_email_hash(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(email)), 'UTF8')), 'hex');
$$;

create table public.member_suspensions (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid unique references auth.users(id) on delete set null,
  reason text check (reason is null or (reason = btrim(reason) and char_length(reason) between 1 and 500)),
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz not null default now()
);

alter table public.member_suspensions enable row level security;
revoke all on public.member_suspensions from public, anon, authenticated;

create or replace function public.member_is_suspended(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null and exists (
    select 1 from public.member_suspensions suspension where suspension.user_id = target_user
  );
$$;

-- 只回答“我自己是否被停用”，给 get_member_context（调用者身份执行）使用，不能查别人。
create or replace function public.current_member_is_suspended()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.member_is_suspended(auth.uid());
$$;

-- 关口一：onboarding 完成判定。停用成员一律视为未完成，主应用的 RLS 与 RPC 随之关闭。
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
  ) and not public.member_is_suspended(auth.uid());
$$;

-- 关口二：当前学校。停用成员没有当前学校，按学校判定的策略同样关闭。
create or replace function public.current_school_id()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.member_is_suspended(auth.uid()) then null
    else public.effective_member_school_id(auth.uid())
  end;
$$;

-- 资料的“本人总能修改”策略不经过上面两个关口，这里单独拦住停用成员改资料。
create or replace function public.block_suspended_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id = auth.uid() and public.member_is_suspended(new.id) then
    raise exception using errcode = '42501', message = 'account_suspended';
  end if;
  return new;
end;
$$;

create trigger profiles_block_suspended_update
  before update on public.profiles
  for each row execute function public.block_suspended_profile_update();

-- get_member_context 增加 suspended；返回列变化只能先删再建（同 202610270001）。
drop function public.get_member_context(text);
create function public.get_member_context(candidate_domain text)
returns table (
  user_id uuid,
  home_school_id text,
  enabled_school_id text,
  current_school_id text,
  onboarding_complete boolean,
  reverification_required boolean,
  suspended boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    member.user_id,
    member.school_id,
    public.enabled_school_id_for_email_domain(candidate_domain),
    public.current_school_id(),
    public.has_completed_onboarding(),
    public.member_requires_email_reverification(),
    public.current_member_is_suspended()
  from public.member_accounts member
  where member.user_id = (select auth.uid());
$$;

-- 注册 Hook：在原有学校域名检查之外，拒绝仍在停用名单上的邮箱重新注册。
create or replace function public.hook_restrict_user_to_enabled_school(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate_email text := btrim(event->'user'->>'email');
  candidate_domain text;
begin
  if candidate_email is null
    or candidate_email = ''
    or length(candidate_email) - length(replace(candidate_email, '@', '')) <> 1
  then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Email is not eligible for an enabled school.'
      )
    );
  end if;

  candidate_domain := lower(split_part(candidate_email, '@', 2));

  if public.enabled_school_id_for_email_domain(candidate_domain) is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Email is not eligible for an enabled school.'
      )
    );
  end if;

  if exists (
    select 1 from public.member_suspensions suspension
    where suspension.email_hash = public.suspension_email_hash(candidate_email)
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This account has been suspended.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

create or replace function public.admin_suspend_member(target_user uuid, suspension_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_platform_role('admin');
  actor_role text;
  target_role text;
  target_email text;
  normalized_reason text := nullif(btrim(suspension_reason), '');
begin
  if target_user is null or target_user = actor then
    return 'invalid_target';
  end if;
  if char_length(normalized_reason) > 500 then
    return 'invalid_reason';
  end if;
  select email into target_email from auth.users where id = target_user;
  if target_email is null then
    return 'not_found';
  end if;
  select role into actor_role from public.platform_roles where user_id = actor;
  select role into target_role from public.platform_roles where user_id = target_user;
  if target_role = 'owner' or (target_role = 'admin' and actor_role <> 'owner') then
    return 'not_allowed';
  end if;

  insert into public.member_suspensions (email_hash, user_id, reason, suspended_by)
  values (public.suspension_email_hash(target_email), target_user, normalized_reason, actor)
  on conflict (email_hash) do update
    set user_id = excluded.user_id, reason = excluded.reason,
        suspended_by = excluded.suspended_by, suspended_at = now();

  -- 立即撤销登录会话；已签发的访问令牌最多 15 分钟后失效，期间数据库关口已经关闭。
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using target_user;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1' using target_user::text;
  end if;

  perform public.write_admin_audit(actor, 'member.suspend', target_user::text,
    jsonb_strip_nulls(jsonb_build_object('reason', normalized_reason)));
  return 'suspended';
end;
$$;

create or replace function public.admin_unsuspend_member(target_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_platform_role('admin');
begin
  delete from public.member_suspensions where user_id = target_user;
  if not found then
    return 'not_suspended';
  end if;
  perform public.write_admin_audit(actor, 'member.unsuspend', target_user::text, '{}'::jsonb);
  return 'unsuspended';
end;
$$;

-- 账号已注销（user_id 已置空）时，只能按邮箱解除，允许其重新注册。
create or replace function public.admin_unsuspend_email(target_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_platform_role('admin');
begin
  delete from public.member_suspensions where email_hash = public.suspension_email_hash(target_email);
  if not found then
    return 'not_suspended';
  end if;
  -- 审计不记录邮箱本身。
  perform public.write_admin_audit(actor, 'member.unsuspend_email', null, '{}'::jsonb);
  return 'unsuspended';
end;
$$;

revoke all on function public.suspension_email_hash(text) from public, anon, authenticated;
revoke all on function public.member_is_suspended(uuid) from public, anon, authenticated;
revoke all on function public.block_suspended_profile_update() from public, anon, authenticated;
revoke all on function public.current_member_is_suspended() from public, anon, authenticated;
grant execute on function public.current_member_is_suspended() to authenticated;
revoke execute on function public.has_completed_onboarding() from public;
grant execute on function public.has_completed_onboarding() to authenticated;
revoke all on function public.current_school_id() from public, anon, authenticated;
grant execute on function public.current_school_id() to authenticated;
revoke all on function public.get_member_context(text) from public, anon, authenticated;
grant execute on function public.get_member_context(text) to authenticated;
revoke execute on function public.hook_restrict_user_to_enabled_school(jsonb) from public, anon, authenticated;
grant execute on function public.hook_restrict_user_to_enabled_school(jsonb) to supabase_auth_admin;
revoke all on function public.admin_suspend_member(uuid, text), public.admin_unsuspend_member(uuid),
  public.admin_unsuspend_email(text) from public, anon;
grant execute on function public.admin_suspend_member(uuid, text), public.admin_unsuspend_member(uuid),
  public.admin_unsuspend_email(text) to authenticated;

commit;
