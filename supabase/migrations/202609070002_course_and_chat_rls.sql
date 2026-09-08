-- 课程与群聊的 RLS 策略
--
-- 权限用「先全部收回、再逐项授予」的写法，而不是只写 revoke。Supabase 会通过
-- default privileges 自动把新建表的全部权限授予 anon/authenticated，只写 revoke
-- 等于依赖平台的隐含行为；显式收回再授予，换平台或改默认值都不会失守。
--
-- 递归陷阱：如果 group_members 的策略里去查 group_members，Postgres 会在评估策略时
-- 再次触发策略，无限递归报错。下面的 is_* 辅助函数用 SECURITY DEFINER 以表 owner 身份
-- 执行，绕过 RLS，从而打断递归。这些函数一律 set search_path = ''，并写全限定名，
-- 否则 SECURITY DEFINER 会变成提权漏洞。

-- ---------------------------------------------------------------------------
-- 辅助函数
-- ---------------------------------------------------------------------------

-- 学校归属来自 member_accounts，不是 profiles：profile 可以不存在，
-- 但只要能登录就一定有 member_account。
create or replace function public.current_school_id()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select school_id from public.member_accounts where user_id = auth.uid();
$$;

create or replace function public.is_course_member(target_course uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.course_members
    where course_id = target_course and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_member(target_group uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group and user_id = auth.uid()
  );
$$;

-- 两人是否有共同课程，决定能不能看到对方资料
create or replace function public.shares_course_with(target_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_members mine
    join public.course_members theirs on mine.course_id = theirs.course_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
  );
$$;

revoke execute on function
  public.current_school_id(),
  public.is_course_member(uuid),
  public.is_group_member(uuid),
  public.shares_course_with(uuid)
from public;

grant execute on function
  public.current_school_id(),
  public.is_course_member(uuid),
  public.is_group_member(uuid),
  public.shares_course_with(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 开启 RLS（每张表都要开，一张都不能漏）
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.course_members enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.messages       enable row level security;

-- 先全部收回。未登录用户读不到任何业务数据——学校列表由认证模块的
-- schools 策略负责，那是注册页唯一需要的公开数据。
revoke all on public.profiles       from anon, authenticated;
revoke all on public.courses        from anon, authenticated;
revoke all on public.course_members from anon, authenticated;
revoke all on public.groups         from anon, authenticated;
revoke all on public.group_members  from anon, authenticated;
revoke all on public.messages       from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- 不给 DELETE：注销走 auth.users 删除，靠外键级联带走 profile。
grant select, insert, update on public.profiles to authenticated;

-- 只能看到自己，以及有共同课程的人。同校但没同课的人互相看不到。
create policy profiles_select_self_or_classmate on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_course_with(id));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
-- MVP 不开放改课删课：一门课被很多人加入后，任何人都能改标题就是滥用入口。
-- 需要订正时由主开发者走 service_role 处理。
grant select, insert on public.courses to authenticated;

-- 本校课程全部可见（课号搜索需要），跨校不可见。
create policy courses_select_own_school on public.courses
  for select to authenticated
  using (school_id = public.current_school_id());

-- 搜不到课时可以自己建，但只能建在自己学校名下。
create policy courses_insert_own_school on public.courses
  for insert to authenticated
  with check (
    school_id = public.current_school_id()
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- course_members
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.course_members to authenticated;

-- 看得到自己的选课记录，以及自己所在课程的同学名单。
create policy course_members_select on public.course_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_course_member(course_id));

-- 只能把自己加进课，且课必须是本校的（防止跨校混入）。
create policy course_members_insert_self on public.course_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.school_id = public.current_school_id()
    )
  );

-- 退课只能退自己的
create policy course_members_delete_self on public.course_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- groups / group_members：只读，写入完全由 trigger 负责
-- ---------------------------------------------------------------------------
-- 客户端不能直接进群退群——群成员资格严格跟随选课关系，由 course_members 上的
-- trigger 同步。只授予 select，连策略都不给写操作留口子。
grant select on public.groups        to authenticated;
grant select on public.group_members to authenticated;

create policy groups_select_member on public.groups
  for select to authenticated
  using (public.is_course_member(course_id));

create policy group_members_select_member on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- 不开放改删：RLS 的 UPDATE 策略管不住「只能改哪一列」，给了 UPDATE 就等于允许
-- 用户改自己消息的 group_id、created_at。P1 做举报审核时，软删除走 service_role
-- 或一个受限的 SECURITY DEFINER 函数。
grant select, insert on public.messages to authenticated;

-- Realtime 推送同样走这条策略：不在群里就收不到推送。
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_group_member(group_id) and deleted_at is null);

create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_group_member(group_id)
  );
