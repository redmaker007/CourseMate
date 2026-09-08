-- 课程与群聊 schema
--
-- 建立在已上线的认证模块之上，不重复定义它已经拥有的东西：
-- schools / school_email_domains / member_accounts 由 202609050001 创建，
-- 学校邮箱准入由 Before User Created Hook 负责，这里不再做域名校验。
--
-- 身份的唯一来源是 member_accounts。所有指向"某个用户"的外键都引用
-- member_accounts(user_id) 而不是 profiles——按 ADR-0001，profile 是可选的
-- 附加资料，没填昵称不该导致不能选课。

-- ---------------------------------------------------------------------------
-- profiles：可选的个人资料
-- ---------------------------------------------------------------------------
-- 没有 school_id：学校归属属于 member_accounts，这里再存一份就会出现两个真相。
create table public.profiles (
  id           uuid primary key
                 references public.member_accounts(user_id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  major        text check (char_length(major) <= 80),
  grad_year    smallint check (grad_year between 2020 and 2040),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  '可选的个人资料。登录与选课都不要求它存在，缺失时按「未填写资料」展示。';

-- ---------------------------------------------------------------------------
-- courses：课程
-- ---------------------------------------------------------------------------
-- term 是必需的，不是可选项：没有它，2026 秋和 2027 春选同一门课的人会被塞进
-- 同一个群，而「找到这学期的同课同学」正是产品的核心场景。
create table public.courses (
  id         uuid primary key default gen_random_uuid(),
  school_id  text not null references public.schools(id),
  code       text not null check (char_length(trim(code)) between 2 and 20),
  title      text not null check (char_length(trim(title)) between 1 and 120),
  term       text not null check (term ~ '^[0-9]{4}-(spring|summer|fall|winter)$'),
  -- default auth.uid()：RLS 的 with check 要求 created_by = auth.uid()，
  -- 给默认值省得每处 insert 都手填，漏填就被策略拒绝。
  created_by uuid default auth.uid()
               references public.member_accounts(user_id) on delete set null,
  created_at timestamptz not null default now(),

  -- 'CS 540' / 'cs540' / 'CS-540' 视为同一门课，避免同课分裂成多个群
  code_normalized text generated always as (
    upper(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g'))
  ) stored
);

create unique index courses_unique_idx
  on public.courses (school_id, code_normalized, term);

-- 课号搜索走这个索引（前缀匹配）
create index courses_search_idx
  on public.courses (school_id, term, code_normalized text_pattern_ops);

-- ---------------------------------------------------------------------------
-- course_members：选课关系
-- ---------------------------------------------------------------------------
create table public.course_members (
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id   uuid not null default auth.uid()
              references public.member_accounts(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create index course_members_user_idx on public.course_members (user_id);

-- ---------------------------------------------------------------------------
-- groups / group_members：群组
-- ---------------------------------------------------------------------------
-- MVP 阶段一门课一个群，所以 course_id 唯一。以后要支持一课多群（比如分 section），
-- 去掉 unique 即可，其它表结构不用动。
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null unique references public.courses(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null
              references public.member_accounts(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- messages：群聊消息
-- ---------------------------------------------------------------------------
create table public.messages (
  id         bigint generated always as identity primary key,
  group_id   uuid not null references public.groups(id) on delete cascade,
  sender_id  uuid default auth.uid()
               references public.member_accounts(user_id) on delete set null,
  body       text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- 软删除。留着行是为了 P1 的举报/审核有据可查，硬删就查不到了。
  deleted_at timestamptz
);

-- 聊天记录按时间倒序翻页
create index messages_group_created_idx
  on public.messages (group_id, created_at desc);

comment on column public.messages.sender_id is
  '发送者。用户注销后置 null，消息保留显示为「已注销用户」。';

-- ---------------------------------------------------------------------------
-- 触发器
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 建课自动建群
create or replace function public.create_group_for_course()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.groups (course_id, name)
  values (new.id, new.code || ' · ' || new.term);
  return new;
end;
$$;

create trigger courses_auto_create_group
  after insert on public.courses
  for each row execute function public.create_group_for_course();

-- 加课自动入群、退课自动退群
create or replace function public.sync_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group uuid;
begin
  if tg_op = 'INSERT' then
    select id into target_group from public.groups where course_id = new.course_id;
    if target_group is not null then
      insert into public.group_members (group_id, user_id)
      values (target_group, new.user_id)
      on conflict do nothing;
    end if;
    return new;
  else
    select id into target_group from public.groups where course_id = old.course_id;
    if target_group is not null then
      delete from public.group_members
      where group_id = target_group and user_id = old.user_id;
    end if;
    return old;
  end if;
end;
$$;

create trigger course_members_sync_group_insert
  after insert on public.course_members
  for each row execute function public.sync_group_membership();

create trigger course_members_sync_group_delete
  after delete on public.course_members
  for each row execute function public.sync_group_membership();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- 群聊消息推送。Realtime 同样受 RLS 约束——下个 migration 里的 messages SELECT
-- 策略决定了谁能收到推送。
alter publication supabase_realtime add table public.messages;
