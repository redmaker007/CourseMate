-- 平台角色与管理函数
--
-- 让团队成员在网站的管理页完成日常运营——录课、切换学期、管理开放学校——而不必
-- 进 Supabase 后台。决策与理由见 docs/adr/0005-platform-roles-and-admin-functions.md。
--
-- 三级身份：普通成员（没有记录）/ admin / owner
--   · 身份存在 platform_roles 表里，客户端既读不到也写不了。不能放在 profiles
--     或 auth 的 user_metadata 里——那两处成员自己都能改，等于谁都能自封管理员
--   · 管理操作全部是固定的 SECURITY DEFINER 函数：开头校验调用者身份，每次操作
--     写一条 admin_audit_log。管理员碰不到原始表
--   · owner 独有：任命 / 撤销 admin、学校与邮箱域名（直接决定谁能登录）
--
-- 错误约定：errcode 22023 的提示是写给管理员看的，应用直接展示；42501 表示没有
-- 权限；其余错误应用一律笼统处理，不把内部原文透出去。
--
-- 第一位 owner 只能在 SQL Editor 里手工指定一次，见 docs/runbooks/platform-admin.md。

begin;

-- ---------------------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------------------

create table public.platform_roles (
  -- 挂在成员账号上：只有用学校邮箱登录过的人才能被任命
  user_id uuid primary key references public.member_accounts(user_id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 只能有一位 owner。转让所有权极少发生，走 SQL Editor。
create unique index platform_roles_single_owner
  on public.platform_roles (role) where role = 'owner';

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_recent_idx
  on public.admin_audit_log (created_at desc, id desc);

-- 两张表都不给客户端任何直接权限，也不建策略：读写一律经下面的函数。
alter table public.platform_roles enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.platform_roles, public.admin_audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 内部辅助函数（不授予任何客户端角色）
-- ---------------------------------------------------------------------------

-- 身份不够就抛 42501，够就返回调用者 ID。每个管理函数第一句都调它。
create or replace function public.require_platform_role(minimum_role text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
begin
  select roles.role into caller_role
  from public.platform_roles roles
  where roles.user_id = caller;

  if caller_role is null
    or (minimum_role = 'owner' and caller_role <> 'owner')
  then
    raise exception '没有权限执行这个管理操作' using errcode = '42501';
  end if;

  return caller;
end;
$$;

create or replace function public.write_admin_audit(
  actor uuid,
  action_name text,
  target_name text,
  detail jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_id, action, target, details)
  values (actor, action_name, target_name, coalesce(detail, '{}'::jsonb));
$$;

revoke all on function
  public.require_platform_role(text),
  public.write_admin_audit(uuid, text, text, jsonb)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 查询
-- ---------------------------------------------------------------------------

-- 任何登录成员都能调用，但只返回自己的身份。页面用它决定显不显示管理入口。
create or replace function public.current_platform_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select roles.role
  from public.platform_roles roles
  where roles.user_id = auth.uid();
$$;

-- 学校总览。普通成员的 schools 策略只放出开放中的学校，管理页需要看到全部。
create or replace function public.admin_list_schools()
returns table (
  school_id text,
  name_zh text,
  name_en text,
  enabled boolean,
  current_term text,
  domains text[],
  catalog_count integer,
  current_course_count integer,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_role('admin');

  return query
  select
    schools.id,
    schools.name_zh,
    schools.name_en,
    schools.enabled,
    terms.current_term,
    coalesce(
      (
        select array_agg(domains.domain order by char_length(domains.domain), domains.domain)
        from public.school_email_domains domains
        where domains.school_id = schools.id
      ),
      '{}'::text[]
    ),
    (
      select count(*)::integer
      from public.course_catalog catalog
      where catalog.school_id = schools.id
    ),
    (
      select count(*)::integer
      from public.courses courses
      where courses.school_id = schools.id
        and courses.term = terms.current_term
    ),
    (
      select count(*)::integer
      from public.member_accounts members
      where members.school_id = schools.id
    )
  from public.schools schools
  left join public.school_term_settings terms on terms.school_id = schools.id
  order by schools.enabled desc, schools.name_en;
end;
$$;

create or replace function public.admin_list_staff()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  granted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_role('admin');

  return query
  select
    roles.user_id,
    users.email::text,
    profiles.display_name,
    roles.role,
    roles.created_at
  from public.platform_roles roles
  join auth.users users on users.id = roles.user_id
  left join public.profiles profiles on profiles.id = roles.user_id
  -- 'owner' > 'admin'，所有者排在最前
  order by roles.role desc, roles.created_at;
end;
$$;

create or replace function public.admin_list_audit_log(max_rows integer default 50)
returns table (
  id bigint,
  actor_email text,
  actor_name text,
  action text,
  target text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_role('admin');

  return query
  select
    entries.id,
    users.email::text,
    profiles.display_name,
    entries.action,
    entries.target,
    entries.details,
    entries.created_at
  from public.admin_audit_log entries
  left join auth.users users on users.id = entries.actor_id
  left join public.profiles profiles on profiles.id = entries.actor_id
  order by entries.created_at desc, entries.id desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 团队（仅 owner）
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
  normalized_email text := lower(btrim(target_email));
  target uuid;
  existing_role text;
begin
  select members.user_id into target
  from auth.users users
  join public.member_accounts members on members.user_id = users.id
  where lower(users.email) = normalized_email;

  if target is null then
    raise exception '找不到这个邮箱对应的成员。对方需要先用学校邮箱登录一次。'
      using errcode = '22023';
  end if;

  select roles.role into existing_role
  from public.platform_roles roles
  where roles.user_id = target;

  if existing_role is not null then
    raise exception '这位成员已经是%。',
      case existing_role when 'owner' then '所有者' else '管理员' end
      using errcode = '22023';
  end if;

  insert into public.platform_roles (user_id, role, granted_by)
  values (target, 'admin', caller);

  perform public.write_admin_audit(
    caller, 'staff.grant_admin', target::text,
    jsonb_build_object('email', normalized_email)
  );
  return target;
end;
$$;

-- 只撤得掉 admin。owner 不能经网站撤销，避免把自己锁在门外。
create or replace function public.admin_revoke_admin(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
begin
  delete from public.platform_roles roles
  where roles.user_id = target_user
    and roles.role = 'admin';

  if not found then
    raise exception '这位成员不是管理员。' using errcode = '22023';
  end if;

  perform public.write_admin_audit(
    caller, 'staff.revoke_admin', target_user::text, '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 学校与邮箱域名（仅 owner）
-- ---------------------------------------------------------------------------
-- 这几项直接决定谁能登录：登录页和 Auth Hook 都读 enabled_school_id_for_email_domain，
-- 改动立即生效。

-- 新建或改名。新学校一律先关闭，配好域名再开放。
create or replace function public.admin_save_school(
  target_school text,
  new_name_zh text,
  new_name_en text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
  school_key text := lower(btrim(target_school));
  zh text := btrim(new_name_zh);
  en text := btrim(new_name_en);
  created boolean;
begin
  if school_key is null
    or school_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(school_key) > 40
  then
    raise exception '学校 ID 只能用小写字母、数字和连字符，例如 uw-madison。'
      using errcode = '22023';
  end if;

  if coalesce(char_length(zh), 0) not between 1 and 80
    or coalesce(char_length(en), 0) not between 1 and 120
  then
    raise exception '请填写学校的中文名和英文名。' using errcode = '22023';
  end if;

  insert into public.schools (id, name_zh, name_en, enabled)
  values (school_key, zh, en, false)
  on conflict (id) do update
    set name_zh = excluded.name_zh,
        name_en = excluded.name_en
  returning (xmax = 0) into created;

  perform public.write_admin_audit(
    caller,
    case when created then 'school.create' else 'school.rename' end,
    school_key,
    jsonb_build_object('name_zh', zh, 'name_en', en)
  );
end;
$$;

create or replace function public.admin_set_school_enabled(
  target_school text,
  should_enable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
  enable_flag boolean := coalesce(should_enable, false);
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  if enable_flag and not exists (
    select 1 from public.school_email_domains domains
    where domains.school_id = target_school
  ) then
    raise exception '请先为这所学校添加至少一个邮箱域名，再开放。'
      using errcode = '22023';
  end if;

  update public.schools schools
  set enabled = enable_flag
  where schools.id = target_school;

  perform public.write_admin_audit(
    caller,
    case when enable_flag then 'school.enable' else 'school.disable' end,
    target_school,
    '{}'::jsonb
  );
end;
$$;

create or replace function public.admin_add_school_domain(
  target_school text,
  new_domain text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
  -- 容忍顺手带上的 @
  normalized text := ltrim(lower(btrim(new_domain)), '@');
  domain_owner text;
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  if normalized is null
    or normalized !~ '^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$'
  then
    raise exception '域名格式不对。只填 @ 后面的部分，例如 wisc.edu。'
      using errcode = '22023';
  end if;

  select domains.school_id into domain_owner
  from public.school_email_domains domains
  where domains.domain = normalized;

  if domain_owner = target_school then
    raise exception '这个域名已经在这所学校名下。' using errcode = '22023';
  elsif domain_owner is not null then
    raise exception '这个域名已经属于另一所学校（%）。', domain_owner
      using errcode = '22023';
  end if;

  insert into public.school_email_domains (domain, school_id)
  values (normalized, target_school);

  perform public.write_admin_audit(
    caller, 'school.add_domain', target_school,
    jsonb_build_object('domain', normalized)
  );
end;
$$;

create or replace function public.admin_remove_school_domain(target_domain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('owner');
  normalized text := ltrim(lower(btrim(target_domain)), '@');
  domain_school text;
  school_enabled boolean;
begin
  select domains.school_id, schools.enabled
  into domain_school, school_enabled
  from public.school_email_domains domains
  join public.schools schools on schools.id = domains.school_id
  where domains.domain = normalized;

  if domain_school is null then
    raise exception '找不到这个域名。' using errcode = '22023';
  end if;

  if school_enabled and (
    select count(*) from public.school_email_domains domains
    where domains.school_id = domain_school
  ) = 1 then
    raise exception '这是这所开放学校的最后一个域名，删掉后没人能登录。请先关闭学校。'
      using errcode = '22023';
  end if;

  delete from public.school_email_domains domains
  where domains.domain = normalized;

  perform public.write_admin_audit(
    caller, 'school.remove_domain', domain_school,
    jsonb_build_object('domain', normalized)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 学期（admin）
-- ---------------------------------------------------------------------------

-- 切换当前学期，并立刻把目录物化成新学期的课程。
--
-- 旧学期课程会话的归档由 school_term_settings 上的触发器完成（202609100002）。
-- 切回原学期同样由那个触发器恢复，所以误操作可以撤回；只是新学期已经建出的
-- 空课程会留着。
create or replace function public.admin_set_current_term(
  target_school text,
  new_term text
)
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
#variable_conflict use_column
declare
  caller uuid := public.require_platform_role('admin');
  normalized text := lower(btrim(new_term));
  previous_term text;
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  if normalized is null
    or normalized !~ '^[0-9]{4}-(spring|summer|fall|winter)$'
  then
    raise exception '学期格式应为「年份-季节」，例如 2027-spring。'
      using errcode = '22023';
  end if;

  select terms.current_term into previous_term
  from public.school_term_settings terms
  where terms.school_id = target_school;

  if previous_term = normalized then
    raise exception '当前学期已经是 %。', normalized using errcode = '22023';
  end if;

  insert into public.school_term_settings (school_id, current_term, updated_at)
  values (target_school, normalized, now())
  on conflict (school_id) do update
    set current_term = excluded.current_term,
        updated_at = excluded.updated_at;

  perform public.write_admin_audit(
    caller, 'term.switch', target_school,
    jsonb_build_object('from', previous_term, 'to', normalized)
  );

  return query
  select * from public.materialize_catalog_courses(target_school);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 课程录入（admin）
-- ---------------------------------------------------------------------------

-- 批量写入课程目录。管理页在浏览器里解析课表，按批调用。
--
-- 为什么不在服务器上解析上传的文件：Server Action 默认只收 1MB 请求体，Vercel
-- 的硬上限是 4.5MB，整份官方课表可能超过。浏览器解析后分批发送就没有这个问题。
--
-- 客户端发来的数据不可信，这里逐项重新校验；只要有一行不合格，整批不写并指出
-- 是哪一门——宁可整批重来，也不要写进一半。
create or replace function public.admin_import_catalog_batch(
  target_school text,
  entries jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('admin');
  entry_count integer;
  bad_code text;
  written integer;
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception '导入数据格式不对。' using errcode = '22023';
  end if;

  entry_count := jsonb_array_length(entries);
  if entry_count = 0 then
    return 0;
  end if;
  if entry_count > 500 then
    raise exception '每批最多 500 门课。' using errcode = '22023';
  end if;

  -- 长度上限与 course_catalog 的约束一致；约束之外的选填字段也设上限，防止灌入
  -- 超大文本
  select coalesce(nullif(btrim(item->>'code'), ''), '（空课号）') into bad_code
  from jsonb_array_elements(entries) item
  where jsonb_typeof(item) <> 'object'
    or coalesce(char_length(btrim(item->>'code')), 0) not between 2 and 40
    or coalesce(char_length(btrim(item->>'subject')), 0) not between 1 and 20
    or coalesce(char_length(btrim(item->>'number')), 0) not between 1 and 10
    or coalesce(char_length(btrim(item->>'title')), 0) not between 1 and 200
    or coalesce(char_length(item->>'credits'), 0) > 40
    or coalesce(char_length(item->>'department'), 0) > 200
    or coalesce(char_length(item->>'typicallyOffered'), 0) > 200
    or coalesce(char_length(item->>'requisites'), 0) > 4000
    or coalesce(char_length(item->>'description'), 0) > 10000
    or coalesce(char_length(item->>'sourceCourseId'), 0) > 40
    or coalesce(char_length(item->>'sourceTerm'), 0) > 40
  limit 1;

  if found then
    raise exception '这批数据里有不合格的课（%），整批没有写入。', bad_code
      using errcode = '22023';
  end if;

  -- 批内规范化后重复的课号只取第一条：同一句 upsert 里撞同一行会报错
  insert into public.course_catalog (
    school_id, code, subject, number, title, credits, department,
    typically_offered, requisites, description, source_course_id,
    source_term, updated_at
  )
  select distinct on (upper(regexp_replace(item->>'code', '[^a-zA-Z0-9]', '', 'g')))
    target_school,
    btrim(item->>'code'),
    btrim(item->>'subject'),
    btrim(item->>'number'),
    btrim(item->>'title'),
    nullif(btrim(item->>'credits'), ''),
    nullif(btrim(item->>'department'), ''),
    nullif(btrim(item->>'typicallyOffered'), ''),
    nullif(btrim(item->>'requisites'), ''),
    nullif(btrim(item->>'description'), ''),
    nullif(btrim(item->>'sourceCourseId'), ''),
    nullif(btrim(item->>'sourceTerm'), ''),
    now()
  from jsonb_array_elements(entries) with ordinality as rows (item, position)
  order by upper(regexp_replace(item->>'code', '[^a-zA-Z0-9]', '', 'g')), position
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
        updated_at = excluded.updated_at;

  get diagnostics written = row_count;

  perform public.write_admin_audit(
    caller, 'catalog.import_batch', target_school,
    jsonb_build_object('count', written)
  );
  return written;
end;
$$;

-- 把目录物化成当前学期的课程。导入完成后管理页自动调用一次，也可以手动重跑。
create or replace function public.admin_materialize_catalog(target_school text)
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
#variable_conflict use_column
declare
  caller uuid := public.require_platform_role('admin');
  outcome record;
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.school_term_settings terms
    where terms.school_id = target_school
  ) then
    raise exception '这所学校还没有设置当前学期，请先设置。' using errcode = '22023';
  end if;

  select * into outcome from public.materialize_catalog_courses(target_school);

  perform public.write_admin_audit(
    caller, 'catalog.materialize', target_school, to_jsonb(outcome)
  );

  return query
  select
    outcome.materialized_term,
    outcome.created_count,
    outcome.existing_count,
    outcome.invalid_count;
end;
$$;

-- 新增或修改一门课：写进目录，并同步到当前学期的课程。
--
-- 返回 'created'（新建了当前学期课程）、'updated'（改了已有课程的课名）或
-- 'catalog_only'（只进了目录：学校没设学期，或课号 / 课名超出课程表的长度限制）。
create or replace function public.admin_save_catalog_course(
  target_school text,
  course_code text,
  course_title text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_platform_role('admin');
  code_text text := upper(regexp_replace(btrim(course_code), '\s+', ' ', 'g'));
  title_text text := regexp_replace(btrim(course_title), '\s+', ' ', 'g');
  parts text[];
  normalized text;
  configured_term text;
  outcome text;
begin
  if not exists (select 1 from public.schools schools where schools.id = target_school) then
    raise exception '找不到这所学校。' using errcode = '22023';
  end if;

  -- 学科可以含空格（'ACCT I S'），所以从末尾切编号：学科必须以非数字结尾
  parts := regexp_match(
    code_text,
    '^(.*[^0-9[:space:]])[[:space:]]*([0-9]{1,4}[A-Z]?)$'
  );

  if parts is null
    or char_length(code_text) not between 2 and 40
    or char_length(btrim(parts[1])) > 20
  then
    raise exception '课号格式应为「学科 + 编号」，例如 EECS 280。'
      using errcode = '22023';
  end if;

  if coalesce(char_length(title_text), 0) not between 1 and 200 then
    raise exception '课名需要 1–200 个字符。' using errcode = '22023';
  end if;

  normalized := regexp_replace(code_text, '[^A-Z0-9]', '', 'g');

  insert into public.course_catalog (school_id, code, subject, number, title, updated_at)
  values (target_school, code_text, btrim(parts[1]), parts[2], title_text, now())
  on conflict (school_id, code_normalized) do update
    set code = excluded.code,
        subject = excluded.subject,
        number = excluded.number,
        title = excluded.title,
        updated_at = excluded.updated_at;

  select terms.current_term into configured_term
  from public.school_term_settings terms
  where terms.school_id = target_school;

  -- 课程表的约束比目录严（课号 2–20 字、课名 1–120 字）
  if configured_term is null
    or char_length(code_text) > 20
    or char_length(title_text) > 120
  then
    outcome := 'catalog_only';
  else
    update public.courses courses
    set code = code_text,
        title = title_text
    where courses.school_id = target_school
      and courses.term = configured_term
      and courses.code_normalized = normalized;

    if found then
      outcome := 'updated';
    else
      -- create_conversation_for_course 触发器会自动配好课程会话
      insert into public.courses (school_id, code, title, term)
      values (target_school, code_text, title_text, configured_term);
      outcome := 'created';
    end if;
  end if;

  perform public.write_admin_audit(
    caller, 'catalog.save_course', target_school,
    jsonb_build_object('code', code_text, 'title', title_text, 'outcome', outcome)
  );
  return outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 执行权
-- ---------------------------------------------------------------------------
-- 按 202609100005 的规矩写全：收回 public、anon、authenticated，再只授予
-- authenticated。身份校验在函数内部，未登录用户连调用的机会都没有。

revoke all on function
  public.current_platform_role(),
  public.admin_list_schools(),
  public.admin_list_staff(),
  public.admin_list_audit_log(integer),
  public.admin_grant_admin(text),
  public.admin_revoke_admin(uuid),
  public.admin_save_school(text, text, text),
  public.admin_set_school_enabled(text, boolean),
  public.admin_add_school_domain(text, text),
  public.admin_remove_school_domain(text),
  public.admin_set_current_term(text, text),
  public.admin_import_catalog_batch(text, jsonb),
  public.admin_materialize_catalog(text),
  public.admin_save_catalog_course(text, text, text)
from public, anon, authenticated;

grant execute on function
  public.current_platform_role(),
  public.admin_list_schools(),
  public.admin_list_staff(),
  public.admin_list_audit_log(integer),
  public.admin_grant_admin(text),
  public.admin_revoke_admin(uuid),
  public.admin_save_school(text, text, text),
  public.admin_set_school_enabled(text, boolean),
  public.admin_add_school_domain(text, text),
  public.admin_remove_school_domain(text),
  public.admin_set_current_term(text, text),
  public.admin_import_catalog_batch(text, jsonb),
  public.admin_materialize_catalog(text),
  public.admin_save_catalog_course(text, text, text)
to authenticated;

commit;
