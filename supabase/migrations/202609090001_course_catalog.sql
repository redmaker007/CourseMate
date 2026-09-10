-- 课程目录：学校有哪些课的参考数据
--
-- 与 courses 的区别是这份文档里最容易搞混的一点：
--
--   course_catalog  这所学校开过哪些课      不带学期、不建群、不能加入
--   courses         这学期这门课的那个群    带学期、自动建群、学生加入
--
-- 分开是因为两者的生命周期完全不同。课名和简介很少变，一次导入长期有效；
-- 而群是每学期新建、有成员的。如果把整份课表灌进 courses，会立刻产生几千个
-- 空群，而且每学期都要重导一遍。
--
-- 数据来源是学校官方公开的课程目录，导入走 scripts/import-course-catalog.mts。
-- 为什么不逆向学校的选课接口，见 docs/adr/0002-*。

create table public.course_catalog (
  id                uuid primary key default gen_random_uuid(),
  school_id         text not null references public.schools(id) on delete cascade,

  -- 原样保留学校写法，例如 'ACCT I S 100'。UW 的学科缩写本身含空格。
  code              text not null check (char_length(trim(code)) between 2 and 40),
  -- 从 code 拆出来，便于按院系浏览。拆分靠学科缩写表做最长前缀匹配，
  -- 不能简单按空格切——'ACCT I S 100' 按空格切会得到 'ACCT'。
  subject           text not null check (char_length(trim(subject)) between 1 and 20),
  number            text not null check (char_length(trim(number)) between 1 and 10),

  title             text not null check (char_length(trim(title)) between 1 and 200),
  -- 存原文不转数字：学分可能是 '1-3' 这样的区间
  credits           text,
  department        text,
  -- 学校原文里没有值时写的是 'Not Applicable'，导入时已转成 null
  typically_offered text,
  requisites        text,
  description       text,

  -- 学校自己的课程编号（如 '002983'）。比课号可靠——课号写法会变，这个不会。
  -- 将来拿到官方 API 数据时用它对账。
  source_course_id  text,
  -- 这批数据来自哪一版课表，如 'Fall 2026'。不是"这门课只在那学期开"。
  source_term       text,

  updated_at        timestamptz not null default now(),

  -- 与 courses 用完全相同的规范化规则，两边才能对得上
  code_normalized text generated always as (
    upper(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g'))
  ) stored
);

-- 一所学校里一门课只有一条。重复导入靠它做 upsert。
create unique index course_catalog_unique_idx
  on public.course_catalog (school_id, code_normalized);

-- 课号前缀搜索（输入 'EECS2' 补全 'EECS 280'）
create index course_catalog_search_idx
  on public.course_catalog (school_id, code_normalized text_pattern_ops);

-- 按院系浏览
create index course_catalog_subject_idx
  on public.course_catalog (school_id, subject);

comment on table public.course_catalog is
  '学校官方课程目录的本地副本，仅作参考与自动补全。学生真正加入的是 courses。';

-- ---------------------------------------------------------------------------
-- 权限
-- ---------------------------------------------------------------------------
alter table public.course_catalog enable row level security;

-- 先全部收回，再逐项授予，不依赖 Supabase default privileges 的隐含行为
revoke all on public.course_catalog from anon, authenticated;
grant select on public.course_catalog to authenticated;

-- 只读，且只能看本校的。写入一律走 service_role（导入脚本），
-- 所以这里不给任何写策略。
create policy course_catalog_select_own_school on public.course_catalog
  for select to authenticated
  using (school_id = public.current_school_id());
