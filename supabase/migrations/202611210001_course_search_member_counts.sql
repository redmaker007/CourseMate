-- 搜索结果显示「学期 · X 位成员」，并把密歇根大学标成安娜堡校区。
--
-- 学生在加入课程之前，按 course_members 的 RLS 只能看到自己的选课行，数不出别人；
-- 所以加入前的成员数只能由一个受控函数给出。这个函数：
--
--   · security definer：只为了能数到别人的选课行。返回值只有 (课程 id, 人数)，
--     不暴露任何成员身份、昵称或选课时间。
--   · 调用者必须已完成资料（has_completed_onboarding），且只统计调用者当前学校
--     （current_school_id，含管理员跨校测试时的测试学校，见 ADR-0006）的课程；
--     传入其他学校的课程 id 一律不返回，与 courses 表的可见范围一致。
--   · 一次最多 200 个课程 id，超出部分忽略，避免被当成全表统计接口。
--   · 人数按 course_members 计，与「加入课程」写入的是同一张表；课程会话是惰性
--     创建的（ADR-0007），还没人加入的课没有会话，人数为 0。
--
-- 只新增函数和改学校显示名，旧前端不调用它，所以先应用迁移、再发布前端。
begin;

create function public.get_course_member_counts(target_courses uuid[])
returns table (course_id uuid, member_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select course.id, count(membership.user_id)::integer
  from (
    select requested.id
    from unnest(target_courses[1:200]) as requested(id)
  ) requested
  join public.courses course
    on course.id = requested.id
   and course.school_id = (select public.current_school_id())
  left join public.course_members membership
    on membership.course_id = course.id
  where (select public.has_completed_onboarding())
  group by course.id;
$$;

revoke all on function public.get_course_member_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_course_member_counts(uuid[]) to authenticated;

-- 学校列表里写清楚是安娜堡校区：课表只有安娜堡的课。Dearborn、Flint 校区的学生
-- 也用 umich.edu 邮箱，名称写明校区，免得他们以为能找到自己学校的课。
update public.schools
set name_zh = '密歇根大学安娜堡分校',
    name_en = 'University of Michigan–Ann Arbor'
where id = 'umich';

commit;
