-- Exact inverse of issue-13-test00.sql. The guards intentionally refuse to
-- delete either UUID if its identifying fields no longer match the fixture.

begin;

do $$
begin
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
    raise exception 'Refusing cleanup because an Issue #13 fixture UUID changed identity';
  end if;
end;
$$;

delete from public.courses
where (id, school_id, code_normalized, title, term) in (
  ('13000000-0000-4000-8000-000000000001', 'uw-madison', 'TEST00', '测试00-测试课程', '2026-fall'),
  ('13000000-0000-4000-8000-000000000002', 'umich', 'TEST00', '测试00-测试课程', '2026-fall')
);

commit;
