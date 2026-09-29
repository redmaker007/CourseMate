-- 课程图片识别额度：图片通过服务端校验、准备调用 OCR 时才消费。
-- 原始图片和 OCR 文本不进入数据库，这张表只记录调用者与调用时间。

create table public.course_recognition_attempts (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.member_accounts(user_id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index course_recognition_attempts_actor_time_idx
  on public.course_recognition_attempts (actor_id, attempted_at desc);
create index course_recognition_attempts_time_idx
  on public.course_recognition_attempts (attempted_at desc);

alter table public.course_recognition_attempts enable row level security;
revoke all on table public.course_recognition_attempts from public, anon, authenticated;
revoke all on sequence public.course_recognition_attempts_id_seq from public, anon, authenticated;

create or replace function public.consume_course_recognition_quota(actor_id uuid)
returns table (
  result_status text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := actor_id;
  checked_at timestamptz;
  oldest_personal_attempt timestamptz;
  personal_count integer;
  monthly_count integer;
begin
  if actor is null or not exists (
    select 1
    from public.member_accounts account
    join public.profiles profile on profile.id = account.user_id
    where account.user_id = actor
      and char_length(trim(profile.display_name)) between 1 and 15
  ) then
    return query select 'onboarding_required'::text, 0;
    return;
  end if;

  -- ponytail: 全站锁让两层额度原子且实现最小；月调用量显著上升时再拆成分片计数器。
  perform pg_catalog.pg_advisory_xact_lock(1129270605);
  checked_at := clock_timestamp();

  delete from public.course_recognition_attempts attempt
  where attempt.attempted_at < least(
    date_trunc('month', checked_at),
    checked_at - interval '10 minutes'
  );

  select count(*)::integer
  into monthly_count
  from public.course_recognition_attempts attempt
  where attempt.attempted_at >= date_trunc('month', checked_at);

  if monthly_count >= 7000 then
    return query
      select
        'global_limit'::text,
        greatest(
          1,
          ceil(extract(epoch from (
            date_trunc('month', checked_at) + interval '1 month' - checked_at
          )))::integer
        );
    return;
  end if;

  select count(*)::integer, min(attempt.attempted_at)
  into personal_count, oldest_personal_attempt
  from public.course_recognition_attempts attempt
  where attempt.actor_id = actor
    and attempt.attempted_at > checked_at - interval '10 minutes';

  if personal_count >= 5 then
    return query
      select
        'personal_limit'::text,
        greatest(
          1,
          ceil(extract(epoch from (
            oldest_personal_attempt + interval '10 minutes' - checked_at
          )))::integer
        );
    return;
  end if;

  insert into public.course_recognition_attempts (actor_id, attempted_at)
  values (actor, checked_at);

  return query select 'allowed'::text, 0;
end;
$$;

revoke execute on function public.consume_course_recognition_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_course_recognition_quota(uuid)
  to service_role;
