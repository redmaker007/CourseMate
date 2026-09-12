-- 只读盘点：仅查询 PostgreSQL 系统目录，不读取成员资料、邮箱或消息正文。
select jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_history_table', to_regclass('supabase_migrations.schema_migrations')::text,
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'replica_identity', c.relreplident) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  ), '[]'::jsonb),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object('table', c.relname, 'column', a.attname,
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
      'identity', a.attidentity, 'generated', a.attgenerated,
      'default', pg_get_expr(d.adbin, d.adrelid)) order by c.relname, a.attnum)
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
      and a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object('table', c.relname, 'name', con.conname,
      'type', con.contype, 'validated', con.convalidated,
      'definition', pg_get_constraintdef(con.oid, true)) order by c.relname, con.conname)
    from pg_constraint con join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname,
      'definition', indexdef) order by tablename, indexname)
    from pg_indexes where schemaname = 'public'
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname,
      'permissive', permissive, 'roles', roles, 'command', cmd, 'using', qual,
      'check', with_check) order by tablename, policyname)
    from pg_policies where schemaname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', c.relname,
      'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true))
      order by n.nspname, c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object('name', p.proname,
      'identity_args', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid), 'security_definer', p.prosecdef,
      'volatility', p.provolatile, 'config', p.proconfig,
      'definition', pg_get_functiondef(p.oid),
      'anon_execute', has_function_privilege('anon', p.oid, 'execute'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'execute'),
      'service_role_execute', has_function_privilege('service_role', p.oid, 'execute'))
      order by p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f','p')
  ), '[]'::jsonb),
  'table_grants', coalesce((
    select jsonb_agg(jsonb_build_object('table', table_name, 'grantee', grantee,
      'privilege', privilege_type) order by table_name, grantee, privilege_type)
    from information_schema.table_privileges
    where table_schema = 'public' and grantee in ('PUBLIC','anon','authenticated','service_role')
  ), '[]'::jsonb),
  'column_grants', coalesce((
    select jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name,
      'grantee', grantee, 'privilege', privilege_type)
      order by table_name, column_name, grantee, privilege_type)
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('PUBLIC','anon','authenticated','service_role')
  ), '[]'::jsonb),
  'default_acl', coalesce((
    select jsonb_agg(jsonb_build_object('schema', n.nspname,
      'owner', pg_get_userbyid(d.defaclrole), 'type', d.defaclobjtype,
      'acl', d.defaclacl::text) order by n.nspname, d.defaclobjtype)
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' or d.defaclnamespace = 0
  ), '[]'::jsonb),
  'realtime', coalesce((
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename)
      order by schemaname, tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'
  ), '[]'::jsonb)
) as inventory;
