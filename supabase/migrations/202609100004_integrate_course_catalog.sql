-- 课程目录与课程流程的衔接
--
-- 课程流程（202609100002_course_flow）规定学生不能建课，只能加入当前学期已经存在
-- 的 courses。而官方课表导入的是 course_catalog——不带学期的参考数据。两者之间
-- 缺一座桥：不把目录物化成当前学期的 courses，导入的课学生既搜不到也加不了。
--
-- 这个 migration 做三件事：
--   1. 删掉曾经试做过的 schools.current_term，学期只以 school_term_settings 为准
--   2. 课程目录按 ADR-0004 纳入 onboarding 门槛
--   3. 提供 materialize_catalog_courses()，由导入脚本以 service_role 调用

begin;

-- ---------------------------------------------------------------------------
-- 1. 学期只有一个来源
-- ---------------------------------------------------------------------------
-- 课程目录上线时曾另做过一版，把当前学期存成 schools.current_term。那一列已经被
-- 手工应用到了线上项目，但对应的 migration 从未进入 main——属于迁移漂移。课程流程
-- 改用独立的 school_term_settings 表，学期切换时还会自动归档旧会话，设计上更完整。
-- 留着那一列等于有两个"当前学期"，迟早互相矛盾。
--
-- 用 if exists：照 main 的 migration 重建出来的库本来就没有这一列，这里是空操作。
alter table public.schools drop column if exists current_term;

-- ---------------------------------------------------------------------------
-- 2. 课程目录纳入 onboarding 门槛
-- ---------------------------------------------------------------------------
-- 目录建立时 ADR-0004 还不存在，读取策略只校验了学校。现在主应用的所有课程数据都
-- 要求先完成 Profile，目录不应例外。
drop policy if exists course_catalog_select_own_school on public.course_catalog;
create policy course_catalog_select_own_school on public.course_catalog
  for select to authenticated
  using (
    public.has_completed_onboarding()
    and school_id = public.current_school_id()
  );

-- ---------------------------------------------------------------------------
-- 3. 把目录物化成当前学期可加入的课程
-- ---------------------------------------------------------------------------
-- 每学期切换 school_term_settings.current_term 之后重新调用一次，就会为新学期建出
-- 对应的 courses；已有的跳过，可以放心重复执行。新建的每门课都会由
-- create_conversation_for_course 触发器自动配好课程会话。
--
-- 返回列刻意不叫 term / created：plpgsql 里 RETURNS TABLE 的列就是变量，与表列
-- 同名会在 on conflict (…, term) 这类地方被判为有歧义而报错。
create or replace function public.materialize_catalog_courses(target_school text)
returns table (
  materialized_term text,
  created_count integer,
  existing_count integer,
  invalid_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_term text;
  total_rows integer;
  invalid_rows integer;
  inserted_rows integer;
begin
  select settings.current_term into configured_term
  from public.school_term_settings settings
  where settings.school_id = target_school;

  -- 没设学期就不猜：宁可报错让运营补上，也不要把课建进一个错误的学期
  if configured_term is null then
    raise exception '学校 % 尚未设置当前学期（school_term_settings）', target_school;
  end if;

  select count(*) into total_rows
  from public.course_catalog catalog
  where catalog.school_id = target_school;

  -- courses 的约束比 course_catalog 严：课号 2–20 字、课名 1–120 字。不合规的行
  -- 跳过并计数，不截断——截断会静默改掉学校的原文，截出来的课号还可能撞上别的课。
  select count(*) into invalid_rows
  from public.course_catalog catalog
  where catalog.school_id = target_school
    and not (
      char_length(trim(catalog.code)) between 2 and 20
      and char_length(trim(catalog.title)) between 1 and 120
    );

  insert into public.courses (school_id, code, title, term)
  select catalog.school_id, catalog.code, catalog.title, configured_term
  from public.course_catalog catalog
  where catalog.school_id = target_school
    and char_length(trim(catalog.code)) between 2 and 20
    and char_length(trim(catalog.title)) between 1 and 120
  on conflict (school_id, code_normalized, term) do nothing;

  get diagnostics inserted_rows = row_count;

  return query select
    configured_term,
    inserted_rows,
    total_rows - invalid_rows - inserted_rows,
    invalid_rows;
end;
$$;

-- 函数默认对 public 开放执行权，必须先收回。只允许导入脚本所用的 service_role
-- 调用：物化会批量建课并连带建出会话，而课程流程本来就禁止学生建课。
revoke all on function public.materialize_catalog_courses(text)
  from public, anon, authenticated;
grant execute on function public.materialize_catalog_courses(text) to service_role;

commit;
