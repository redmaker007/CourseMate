-- 权限收口：限流表 RLS 声明、内部触发器函数收权、未来新表默认关闭、
-- 消息直写收口、私聊 SELECT 对齐个人清除游标。
--
-- 不创建任何新表，不改变任何现有业务列；只收紧权限面。背景见
-- docs/adr/0008-permission-hardening-and-direct-message-visibility.md
-- 和 docs/STATUS.md 对应条目。

begin;

-- ---------------------------------------------------------------------------
-- 1. 声明两张限流表已经在线上生效的 RLS
-- ---------------------------------------------------------------------------
-- 202609100003 撤销了 anon/authenticated 的表权限，但漏写了
-- enable row level security。只读盘点确认线上其实已经手工开了（这两张表只被
-- SECURITY DEFINER 的 consume_friend_rate_limit 使用，客户端本来就没有表权限），
-- 但迁移文件从未声明，导致本地/PGlite 从零重建的库和线上不一致。这里补上声明，
-- 不新增策略——RLS 开启且没有策略，对已经没有表权限的 anon/authenticated 而言
-- 是双重保险，不改变任何实际可见性。
alter table public.friend_rate_limit_config enable row level security;
alter table public.friend_rate_limit_buckets enable row level security;

-- ---------------------------------------------------------------------------
-- 2. 内部触发器函数：显式收回 PUBLIC 执行权
-- ---------------------------------------------------------------------------
-- 202609100005 只处理了非触发器函数，触发器函数被有意跳过——该文件注释认为
-- PostgREST 不会暴露返回 trigger 的函数，直接调用也会报错，为了不冒影响触发
-- 本身的风险没有动它们。这里重新评估：触发器由触发器管理器按函数 OID 直接调用，
-- 不经过调用者的 EXECUTE 检查，收回 PUBLIC 执行权不影响触发器本身触发——本仓库
-- 覆盖建课/加退课/学期切换/认证邮箱绑定/管理员测试学校清理等全部触发器路径的
-- 完整迁移链测试通过，就是这个结论的证据。收回后这些函数不再出现在安全
-- advisor 的 anon/authenticated 可执行报告里。
--
-- create_conversation_for_course() 不在这份名单里：202609140001 已经把它连同
-- 对应触发器一起删掉了（建课不再自动建会话，见 ADR-0007），这里没有它可收权。
--
-- 和 202609100005 的教训一样：Supabase 会在建函数时把 EXECUTE 单独授予
-- anon 与 authenticated（不只是 PUBLIC 这一级），只写 `from public` 收不回
-- 这两份单独授权，这里三个角色都要写。
revoke execute on function public.touch_updated_at()
  from public, anon, authenticated;
revoke execute on function public.delete_conversation_for_course()
  from public, anon, authenticated;
revoke execute on function public.sync_course_conversation_membership()
  from public, anon, authenticated;
revoke execute on function public.enforce_course_conversation_kind()
  from public, anon, authenticated;
revoke execute on function public.enforce_conversation_membership_source()
  from public, anon, authenticated;
revoke execute on function public.register_direct_conversation_members()
  from public, anon, authenticated;
revoke execute on function public.sync_school_course_archives()
  from public, anon, authenticated;
revoke execute on function public.bind_verified_email_to_member_account()
  from public, anon, authenticated;
revoke execute on function public.reject_auth_email_change()
  from public, anon, authenticated;
revoke execute on function public.prevent_conversation_kind_change()
  from public, anon, authenticated;
revoke execute on function public.clear_disabled_school_test_context()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 未来新表默认不给 anon / authenticated
-- ---------------------------------------------------------------------------
-- 和 202609100005 对函数做的事一样，这次针对表。Supabase 的 postgres 角色默认会
-- 把新建表的全部权限授予 anon 与 authenticated；在这条迁移之前，只要哪条新迁移
-- 忘了显式 revoke，新表就是"默认全开"。此后新表默认没有任何客户端权限——漏写
-- grant 的后果变成功能不可用，而不是悄悄暴露，失败方向反过来了。
-- 不确定 Supabase 默认权限挂在 schema 级还是全局级，两条都写，没挂的那条是
-- 空操作。只影响以后新建的表，不改变任何现有表的权限。
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges
  revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 消息直写收口：只留 RPC 一条路径
-- ---------------------------------------------------------------------------
-- 202609070002 授予 authenticated 对 messages 的 insert，配合课程会话的
-- messages_insert_active_course_member 策略，客户端可以绕开
-- 202609120001 要求的幂等 client_message_id 直接插入课程消息（私聊消息本来就
-- 没有对应的 insert 策略，不受影响）。收回权限后两条路径都必须走
-- send_conversation_message / send_direct_message。update/delete 从未授予过，
-- 这里不需要动，但一并显式收回便于审计。
revoke insert, update, delete on public.messages from authenticated, anon;
drop policy if exists messages_insert_active_course_member on public.messages;

-- ---------------------------------------------------------------------------
-- 5. 私聊 SELECT 对齐个人清除游标
-- ---------------------------------------------------------------------------
-- list_direct_messages 用 conversation_members.cleared_through_message_id
-- 过滤已清除的历史，但 messages_select_direct_member 这条 RLS 策略只检查会话
-- 成员身份，没有检查这个游标——直接对 messages 表 SELECT（REST API 或本地调试）
-- 能读到自己已经清除的私聊记录。补一个按 auth.uid() 取自己清除位置的辅助函数，
-- 加进策略里；只影响调用者自己的可见性，不改变对方的可见性，也不会物理删除
-- 任何记录，物理清理仍按 202609110005 的 720 小时留存窗口另行执行。
create or replace function public.direct_message_clear_position(
  target_conversation_id uuid
)
returns bigint
language sql
security definer
stable
set search_path = ''
as $$
  select member.cleared_through_message_id
  from public.conversation_members member
  where member.conversation_id = target_conversation_id
    and member.user_id = auth.uid();
$$;

revoke execute on function public.direct_message_clear_position(uuid) from public;
grant execute on function public.direct_message_clear_position(uuid) to authenticated;

drop policy if exists messages_select_direct_member on public.messages;
create policy messages_select_direct_member
  on public.messages
  for select to authenticated
  using (
    deleted_at is null
    and public.can_access_direct_conversation(conversation_id)
    and id > coalesce(public.direct_message_clear_position(conversation_id), 0)
  );

commit;
