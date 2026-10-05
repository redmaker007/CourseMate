-- 大厅「我的课程」合并为一次调用。
--
-- 此前 getDashboardCourses 依次发出四轮请求：当前学期 → 我加入的课程 → 课程与会话关联 →
-- 会话归档状态与成员数。后一轮要用前一轮的结果，没法并行，每轮都要跨一次网络（约 80ms），
-- 大厅和导航外壳都在用它。这个函数在数据库内部一次做完，只把最终结果返回。
--
--   · security invoker：所有表照常按调用者的 RLS 读取，可见范围与原来逐表查询完全一致
--     （例如成员数只统计调用者能看到的 conversation_members 行）。不引入新的数据来源，
--     也不放宽任何可见性。
--   · 身份只取 auth.uid()，学校由调用方传入并与 courses.school_id 比对，与原来一致。
--   · 语义与原代码逐项对应：该学校没有设置当前学期、或没有加入任何课程时返回零行；
--     没有会话关联的课程不返回；课程学期不是当前学期、或会话已归档、或会话行读不到时
--     archived 为 true（原来是 `archived_at !== null`，读不到的行是 undefined，同样视为归档）。
--   · 排序仍由调用方完成（按课号 localeCompare），数据库里不排序。
--
-- 只新增函数，旧前端不调用它，所以必须先于新前端应用（先应用迁移，再发布前端）。
begin;

create function public.get_dashboard_courses(target_school text)
returns table (
  course_id uuid,
  school_id text,
  code text,
  title text,
  term text,
  conversation_id uuid,
  archived boolean,
  member_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    course.id,
    course.school_id,
    course.code,
    course.title,
    course.term,
    link.conversation_id,
    (
      course.term <> settings.current_term
      or conversation.id is null
      or conversation.archived_at is not null
    ),
    (
      select count(*)::integer
      from public.conversation_members conversation_member
      where conversation_member.conversation_id = link.conversation_id
    )
  from public.school_term_settings settings
  join public.course_members membership
    on membership.user_id = (select auth.uid())
  join public.courses course
    on course.id = membership.course_id
   and course.school_id = target_school
  join public.course_conversations link
    on link.course_id = course.id
  left join public.conversations conversation
    on conversation.id = link.conversation_id
  where settings.school_id = target_school;
$$;

-- 与其他函数一样显式收回三个角色，再只授予已登录用户（见 202609100005 的教训）。
revoke all on function public.get_dashboard_courses(text) from public, anon, authenticated;
grant execute on function public.get_dashboard_courses(text) to authenticated;

commit;
