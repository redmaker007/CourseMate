-- Issue #13 manual test fixture. Do not include this file in production seed
-- automation. Apply only after confirming the target project.
--
-- Exact fixture rows:
--   13000000-0000-4000-8000-000000000001 / uw-madison
--   13000000-0000-4000-8000-000000000002 / umich
--   TEST00 / 测试00-测试课程 / 2026-fall

begin;

do $$
begin
  if not exists (
    select 1 from public.schools where id = 'uw-madison' and enabled
  ) or not exists (
    select 1 from public.schools where id = 'umich' and enabled
  ) then
    raise exception 'Issue #13 TEST00 seed requires enabled uw-madison and umich schools';
  end if;

  if exists (
    select 1 from public.courses
    where school_id = 'uw-madison'
      and code_normalized = 'TEST00'
      and term = '2026-fall'
      and id <> '13000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.courses
    where school_id = 'umich'
      and code_normalized = 'TEST00'
      and term = '2026-fall'
      and id <> '13000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'A non-fixture TEST00 course already occupies the target school and term';
  end if;

  if exists (
    select 1 from public.courses
    where id = '13000000-0000-4000-8000-000000000001'
      and (school_id, code_normalized, title, term) is distinct from
          ('uw-madison', 'TEST00', '测试00-测试课程', '2026-fall')
  ) or exists (
    select 1 from public.courses
    where id = '13000000-0000-4000-8000-000000000002'
      and (school_id, code_normalized, title, term) is distinct from
          ('umich', 'TEST00', '测试00-测试课程', '2026-fall')
  ) then
    raise exception 'An Issue #13 fixture UUID is already used by different data';
  end if;
end;
$$;

insert into public.courses (id, school_id, code, title, term, created_by)
values
  ('13000000-0000-4000-8000-000000000001', 'uw-madison', 'TEST00', '测试00-测试课程', '2026-fall', null),
  ('13000000-0000-4000-8000-000000000002', 'umich', 'TEST00', '测试00-测试课程', '2026-fall', null)
on conflict (id) do nothing;

commit;
