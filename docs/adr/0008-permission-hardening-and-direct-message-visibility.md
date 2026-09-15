# 权限收口一次性做完，私聊可见性向 RPC 对齐

一次针对现有数据库权限面的盘点（只读系统表 + 官方 security advisor，见 [supabase/preflight/release-inventory.sql](../../supabase/preflight/release-inventory.sql)）发现几处历史遗留的权限缺口：两张限流表的 RLS 只在线上手工开过、没有迁移声明；一批内部触发器函数从未显式收回 `PUBLIC` 执行权；课程消息仍能绕开可靠发送 RPC 直接写表；私聊消息的 SELECT 策略没有对齐个人清除游标。修复落在 `supabase/migrations/202609150001_permission_hardening.sql` 一条迁移里，不建表、不改业务列。

## 为什么现在要收回触发器函数的 PUBLIC 执行权

[202609100005_harden_function_execute_grants.sql](../../supabase/migrations/202609100005_harden_function_execute_grants.sql) 当时特意跳过了触发器函数，理由是"怕影响触发器触发"。重新核实：触发器由触发器管理器按函数 OID 直接调用，不经过调用者的 `EXECUTE` 权限检查，收回 `PUBLIC` 执行权不会影响触发器本身——完整迁移链的测试（建课、加退课、学期切换、认证邮箱绑定、管理员测试学校清理等触发器路径全部覆盖）在收回后仍然全部通过，这就是证据。收回后这些函数不再出现在 Supabase 官方 security advisor 的 anon/authenticated 可执行列表里。

## 为什么新表默认权限也要收紧

Supabase 的 `postgres` 角色默认把新建表的全部权限授予 `anon`/`authenticated`。202609100005 已经对函数做了同样的事，这次补上表：以后新迁移如果忘了显式 `revoke`，新表的默认状态是"没有任何客户端权限"而不是"全部权限"——漏写的后果从悄悄暴露变成功能不可用，失败方向对调了。这条不改变任何已存在表的权限，只影响之后新建的表。

## 为什么消息直写要收口成只留 RPC

`messages` 表的 `insert` 权限和课程会话的插入策略一直没有随 [202609120001_reliable_message_sending.sql](../../supabase/migrations/202609120001_reliable_message_sending.sql) 一起收紧，客户端理论上能绕开幂等 `client_message_id` 直接插入课程消息。私聊消息本来就没有对应的插入策略，不受影响。收回表级 `insert/update/delete` 权限后两条路径都必须经过 `send_conversation_message` / `send_direct_message`，这两个函数是 `SECURITY DEFINER`，按属主身份写表，不受这次收权影响。

## 为什么私聊 SELECT 要接清除游标，而不是物理删除

`list_direct_messages` 一直用 `conversation_members.cleared_through_message_id` 过滤已清除的历史，但直接对 `messages` 表 SELECT（REST API 或本地调试用同一个用户的 JWT）不受这条限制。修复只在 RLS 策略里加了这个游标判断，按 `auth.uid()` 限定，不引入递归依赖：

- 只影响调用者自己的可见性，不改变对方的可见性——对方没清除就仍能看到完整历史。
- 不做物理删除。物理清理仍然是 [202609110005_direct_message_cleanup.sql](../../supabase/migrations/202609110005_direct_message_cleanup.sql) 里双方都清除满 720 小时后的受控批处理，举报证据保留不受影响。
- 不能反过来理解成"清除后对方也看不到"或"清除等于抹掉已经下载到客户端的副本"——这两点都不是本条修复的范围。

## 代价

- 触发器函数收权是对已有决定的推翻，不是新增功能；如果将来发现某个触发器确实需要被外部直接调用（目前没有这种用例），需要单独为它加回显式 `grant`，而不是整体放开。
- 新表默认权限收紧后，忘写 `grant` 的迁移会让对应功能直接报错，需要在集成测试里较早发现，而不是留到人工验收。

## 相关

- Migration：`supabase/migrations/202609150001_permission_hardening.sql`
- 只读盘点脚本：[release-inventory.sql](../../supabase/preflight/release-inventory.sql)
- 函数执行权收口的上一步：[202609100005_harden_function_execute_grants.sql](../../supabase/migrations/202609100005_harden_function_execute_grants.sql)
- 可靠发送与幂等约束：[202609120001_reliable_message_sending.sql](../../supabase/migrations/202609120001_reliable_message_sending.sql)
- 私聊清除与物理清理：[202609110005_direct_message_cleanup.sql](../../supabase/migrations/202609110005_direct_message_cleanup.sql)、[清理交接](../handoffs/direct-message-cleanup.md)
