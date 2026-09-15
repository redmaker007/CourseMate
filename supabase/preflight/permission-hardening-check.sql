-- 只读检查：supabase/migrations/202609150001_permission_hardening.sql 的
-- 五项修复是否生效。只查系统目录，不读成员资料、邮箱或消息正文；应用迁移前
-- 后都能跑——应用前五项应该大多是 false，应用后应该全部是 true。
--
--   supabase db query --linked --file supabase/preflight/permission-hardening-check.sql
select jsonb_build_object(
  'database', current_database(),

  -- 1. 两张限流表是否开了 RLS
  'rate_limit_tables_rls', (
    select jsonb_object_agg(relname, relrowsecurity order by relname)
    from pg_class
    where relname in ('friend_rate_limit_config', 'friend_rate_limit_buckets')
  ),

  -- 2. 内部触发器函数是否已经收回 anon/authenticated 的执行权
  --    （touch_updated_at 起这 11 个；create_conversation_for_course 已在
  --    202609140001 被删掉，不在检查范围）
  'trigger_functions_still_public', coalesce((
    select jsonb_agg(procedure.proname order by procedure.proname)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'touch_updated_at', 'delete_conversation_for_course',
        'sync_course_conversation_membership', 'enforce_course_conversation_kind',
        'enforce_conversation_membership_source',
        'register_direct_conversation_members', 'sync_school_course_archives',
        'bind_verified_email_to_member_account', 'reject_auth_email_change',
        'prevent_conversation_kind_change', 'clear_disabled_school_test_context'
      )
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
  ), '[]'::jsonb),

  -- 3. 新表默认权限：这里只能确认修复已经写入（返回值恒真，default privileges
  --    不能回溯检查历史效果），真正生效与否要在这条迁移之后新建一张测试表验证
  'messages_privileges', coalesce((
    select jsonb_agg(jsonb_build_object('grantee', grantee, 'privilege', privilege_type)
      order by grantee, privilege_type)
    from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'messages'
      and grantee in ('anon', 'authenticated')
  ), '[]'::jsonb),

  -- 4. 私聊 SELECT 策略是否已经接上清除游标
  'direct_message_select_policy', (
    select qual from pg_policies
    where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_select_direct_member'
  ),

  -- 5. 课程消息的直写策略应该已经被删掉
  'course_message_insert_policy_still_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_insert_active_course_member'
  ),

  -- 附带确认本次要诊断的那条 SQL Editor 假警告：不存在名为 the 的表
  'phantom_table_the_exists', to_regclass('public.the') is not null
) as permission_hardening_check;
