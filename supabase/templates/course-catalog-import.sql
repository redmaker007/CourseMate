-- 课程目录批量导入模板（仅数据写入，不建表、不改权限）
--
-- 日常导入请用网站的 /admin 页面：它和 scripts/import-course-catalog.mts 共用
-- 同一个解析器，经 admin_import_catalog_batch -> admin_materialize_catalog，
-- 带完整校验、分批、审计与幂等重试，见 docs/runbooks/seed-courses.md。
--
-- 这份模板只留给页面用不了的场合：新建 Supabase 项目、还没有任何管理员的时候
-- （见 docs/runbooks/new-supabase-project.md）。它不是第二套导入系统，只是同一
-- 张目标表 public.course_catalog 的受信任所有者直连写入方式。
--
-- ⚠️ 用直连方式执行，不要整份贴进 Studio 网页版 SQL Editor 执行：
-- 网页版 SQL Editor 不会把粘贴内容当一个事务跑，begin/commit 不生效，出错也不
-- 会停（原因见 docs/runbooks/new-supabase-project.md）。这份模板依赖事务保证
-- 「要么整批生效，要么整批不生效」，必须用下面这类直连方式之一：
--
--   supabase db query --linked --file supabase/templates/course-catalog-import.sql
--
--   psql "$DATABASE_URL" -f supabase/templates/course-catalog-import.sql
--
-- 使用步骤：
--   1. 把下面两条示例行换成实际课程数据，每行一门课，字段顺序不要动，行数
--      不限；不需要的可选字段写 null，不要写源数据里 "Not Applicable" 这类
--      占位字符串。
--   2. 把两处 'uw-madison' 换成实际学校 id，且要和 VALUES 里用的学校一致。
--   3. 执行后看两条 SELECT 的输出：本次导入行数，以及物化结果（新建/已存在/
--      不合规门数）。
--
-- 这份模板做且只做这些事：
--   · 只 upsert 进已存在的 public.course_catalog，冲突键固定是
--     (school_id, code_normalized)——code_normalized 是生成列，不能出现在
--     插入列表里，写了会直接报错
--   · 同一批数据里重复的课号会先去重再插入，避免同一个冲突目标在一条 INSERT
--     里命中两次直接报错；保留哪一条不保证，源数据里有重复课号应先在源头去重
--   · 写完目录后调用已有的特权函数 materialize_catalog_courses()，物化成当前
--     学期的 courses；这个函数按数据库角色授权，不校验 auth.uid()，直连执行
--     天然满足，不需要也不应该伪造应用层的管理员身份
--   · 不创建表、不建索引、不改列、不关闭或修改任何 RLS 策略与权限
--
-- 字段长度要求（和 admin_import_catalog_batch 用的规则一致，
-- public.course_catalog 的 CHECK 约束也会兜底拦截超限的 code/subject/number/
-- title）：
--   code 2–40 字、subject 1–20 字、number 1–10 字、title 1–200 字；
--   credits/department/typically_offered/requisites/description 均可为
--   null；source_course_id 按学校原文保留成字符串（可能有前导零或小数点，
--   不要转成数字，也不要转成空字符串——空值一律写 null）。

begin;

with new_rows (
  school_id, code, subject, number, title, credits, department,
  typically_offered, requisites, description, source_course_id, source_term
) as (
  values
    -- ### 在此替换成实际数据（下面两行是示例，删掉或保留都可以） ### --------
    ('uw-madison', 'ACCT I S 100', 'ACCT I S', '100', 'Survey of Accounting',
     '3', 'ACCOUNTING', 'Fall, Spring', null,
     'A survey of financial and managerial accounting concepts.',
     '002983', 'Fall 2026'),
    ('uw-madison', 'ACCT I S 211', 'ACCT I S', '211',
     'Introduction to Financial Accounting', '4', 'ACCOUNTING', 'Fall, Spring',
     'Sophomore standing',
     'Introduction to the preparation and use of financial statements.',
     '002984', 'Fall 2026')
    -- ### 替换结束 ### ------------------------------------------------------
),
deduped_rows as (
  select distinct on (
    school_id, upper(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g'))
  ) *
  from new_rows
),
inserted as (
  insert into public.course_catalog (
    school_id, code, subject, number, title, credits, department,
    typically_offered, requisites, description, source_course_id,
    source_term, updated_at
  )
  select
    school_id, code, subject, number, title, credits, department,
    typically_offered, requisites, description, source_course_id,
    source_term, now()
  from deduped_rows
  on conflict (school_id, code_normalized) do update
    set code = excluded.code,
        subject = excluded.subject,
        number = excluded.number,
        title = excluded.title,
        credits = excluded.credits,
        department = excluded.department,
        typically_offered = excluded.typically_offered,
        requisites = excluded.requisites,
        description = excluded.description,
        source_course_id = excluded.source_course_id,
        source_term = excluded.source_term,
        updated_at = excluded.updated_at
  returning 1
)
select count(*) as 本次导入行数 from inserted;

-- 把学校 id 换成和上面 VALUES 一致的值；这个函数要求该校已在
-- school_term_settings 设好当前学期，否则会报错而不是猜一个学期。
select * from public.materialize_catalog_courses('uw-madison');

commit;
