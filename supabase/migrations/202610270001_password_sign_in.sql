-- 密码登录与每 30 天重新验证邮箱（见 ADR-0011）。
--
-- · member_auth_state：每个成员最近一次验证码验证的时间，以及经本应用流程设置的密码指纹。
--   不对任何客户端角色开放，只经下面的 security definer 函数读写。
-- · 会话怎么登录的，只看 JWT 的 amr（Auth 签发，客户端改不了）：验证码是 otp，密码是 password。
-- · get_member_context 新增 reverification_required；应用入口据此要求重新输验证码。
--
-- 测试替身的 auth.users 没有 encrypted_password／last_sign_in_at，所以按
-- to_jsonb(行)->>'列' 读取（与 202610260002 读 auth.sessions.not_after 的写法一致）。
begin;

create table public.member_auth_state (
  user_id uuid primary key references public.member_accounts(user_id) on delete cascade,
  email_verified_at timestamptz not null,
  password_fingerprint text,
  password_set_at timestamptz
);
alter table public.member_auth_state enable row level security;
revoke all on public.member_auth_state from public, anon, authenticated, service_role;

-- 已有成员此前只能用验证码登录，最近登录时间就是最近一次验证邮箱的时间。
insert into public.member_auth_state (user_id, email_verified_at)
select member.user_id,
  coalesce((to_jsonb(u) ->> 'last_sign_in_at')::timestamptz, u.email_confirmed_at, now())
from public.member_accounts member
join auth.users u on u.id = member.user_id;

-- 当前会话里验证码登录的时间；没有 otp 记录时为 null。
create function public.session_email_otp_at()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(to_timestamp((entry ->> 'timestamp')::double precision))
  from jsonb_array_elements(
    case
      when jsonb_typeof(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr') = 'array'
        then nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr'
      else '[]'::jsonb
    end
  ) entry
  where entry ->> 'method' = 'otp'
    and jsonb_typeof(entry -> 'timestamp') = 'number';
$$;

create function public.session_uses_password()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr' @> '[{"method": "password"}]'::jsonb,
    false
  );
$$;

-- 验证码登录或设置密码时的验码之后调用；只认 10 分钟内的 otp。
create function public.record_email_verification()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  verified_at timestamptz := public.session_email_otp_at();
begin
  if actor is null or verified_at is null or verified_at < now() - interval '10 minutes'
    or verified_at > now() + interval '1 minute' then
    raise exception 'recent_email_verification_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.member_accounts where user_id = actor) then
    raise exception 'member_required' using errcode = '42501';
  end if;
  insert into public.member_auth_state as state (user_id, email_verified_at)
  values (actor, verified_at)
  on conflict (user_id) do update
    set email_verified_at = greatest(state.email_verified_at, excluded.email_verified_at);
  return 'recorded';
end;
$$;

-- 在 Auth 改完密码之后调用，记下这一刻的密码哈希指纹。同样要求 10 分钟内的 otp，
-- 所以只拿到会话、没收到验证码的人不能登记密码。
create function public.record_password_set()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  verified_at timestamptz := public.session_email_otp_at();
  hash text;
begin
  if actor is null or verified_at is null or verified_at < now() - interval '10 minutes' then
    raise exception 'recent_email_verification_required' using errcode = '42501';
  end if;
  select to_jsonb(u) ->> 'encrypted_password' into hash from auth.users u where u.id = actor;
  if nullif(hash, '') is null then
    raise exception 'password_not_set' using errcode = '22023';
  end if;
  insert into public.member_auth_state as state (user_id, email_verified_at, password_fingerprint, password_set_at)
  values (actor, verified_at, md5(hash), now())
  on conflict (user_id) do update
    set email_verified_at = greatest(state.email_verified_at, excluded.email_verified_at),
        password_fingerprint = excluded.password_fingerprint,
        password_set_at = excluded.password_set_at;
  return 'recorded';
end;
$$;

-- 本人是否设过（仍有效的）密码；给"我的"页显示状态用。
create function public.own_password_status()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.member_auth_state state
    join auth.users u on u.id = state.user_id
    where state.user_id = auth.uid()
      and state.password_fingerprint = md5(coalesce(to_jsonb(u) ->> 'encrypted_password', ''))
  );
end;
$$;

-- 当前会话是否必须重新验证邮箱：
-- 1. 账号最近一次验码（库里记录与本会话自身的 otp 取较新者）超过 30 天；
-- 2. 或这是密码会话，但密码不是经本应用流程设置的（指纹缺失或对不上）。
create function public.member_requires_email_reverification()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  state public.member_auth_state%rowtype;
  hash text;
begin
  if actor is null then return true; end if;
  select * into state from public.member_auth_state where user_id = actor;
  if coalesce(greatest(state.email_verified_at, public.session_email_otp_at()), '-infinity'::timestamptz)
      < now() - interval '30 days' then
    return true;
  end if;
  if public.session_uses_password() and public.session_email_otp_at() is null then
    select to_jsonb(u) ->> 'encrypted_password' into hash from auth.users u where u.id = actor;
    return state.password_fingerprint is null or state.password_fingerprint is distinct from md5(coalesce(hash, ''));
  end if;
  return false;
end;
$$;

-- 首次确认邮箱时清掉 Auth 里已有的密码：确认之前设的密码不是邮箱主人设的。
create function public.discard_password_before_email_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 只管第一次确认；之后 Auth 每次验码可能重写确认时间，不能借此清掉本人设的密码。
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;
  if to_jsonb(new) ? 'encrypted_password' then
    new := jsonb_populate_record(new, '{"encrypted_password": ""}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger discard_password_before_email_ownership
before insert or update of email_confirmed_at on auth.users
for each row
when (new.email_confirmed_at is not null)
execute function public.discard_password_before_email_ownership();

-- 返回列变了，只能先删再建。
drop function public.get_member_context(text);
create function public.get_member_context(candidate_domain text)
returns table (
  user_id uuid,
  home_school_id text,
  enabled_school_id text,
  current_school_id text,
  onboarding_complete boolean,
  reverification_required boolean
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
    public.member_requires_email_reverification()
  from public.member_accounts member
  where member.user_id = (select auth.uid());
$$;

revoke all on function public.session_email_otp_at(), public.session_uses_password(),
  public.record_email_verification(), public.record_password_set(), public.own_password_status(),
  public.discard_password_before_email_ownership()
  from public, anon, authenticated, service_role;
-- 与 202609250001 相同：get_member_context 及其内部调用的检查保留 service_role 的默认授权。
revoke all on function public.member_requires_email_reverification(), public.get_member_context(text)
  from public, anon, authenticated;
grant execute on function public.record_email_verification(), public.record_password_set(),
  public.own_password_status(), public.member_requires_email_reverification(),
  public.get_member_context(text)
  to authenticated;

commit;
