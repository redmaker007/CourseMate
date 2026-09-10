# Profile onboarding 交接

Issue #11 实现了强制 Profile onboarding，但本次只提交代码和数据库 migration，**没有向任何托管 Supabase 项目应用 migration**。

## 数据流

1. 学校邮箱验证仍先创建独立的 `member_accounts` 绑定。
2. Proxy 只刷新并验证成员会话，不访问数据库判断 onboarding，避免每个请求增加额外往返。
3. 没有有效 Profile 的成员由页面和 Server Action 引导到 `/onboarding/profile`；数据库 RLS 是阻止绕过的最终安全边界。
4. Profile Server Action 从当前会话取得用户 ID，规范化输入后 upsert 自己的 `profiles` 行。
5. 保存成功后 onboarding 页面进入原站内目标；之后可以从 `/profile` 修改资料。

## 旧资料与约束验证

应用 migration 前，必须先在目标环境运行只读脚本 `supabase/preflight/202609090002_profile_onboarding.sql`，保存无效资料数量和 ID 清单，确认受影响用户范围。该脚本不会修改数据。

Migration `202609090002_profile_onboarding.sql` 新增了 `profiles_display_name_onboarding_check`，并使用 `NOT VALID`：

- 新增或更新的资料立即执行 1–15 字数据库约束。
- 已有 16–40 字名称不会被截断或删除，但 `has_completed_onboarding()` 会返回 false，成员必须先修正名称。
- 当托管环境中不存在旧超长名称后，才可以验证完整约束：

```sql
select count(*)
from public.profiles
where char_length(trim(display_name)) not between 1 and 15;

alter table public.profiles
  validate constraint profiles_display_name_onboarding_check;
```

只有第一条查询返回 `0` 时才执行 `validate constraint`。不要用批量截断替代用户修正。

## 部署后检查

- 新成员登录后必须进入 `/onboarding/profile`。
- 15 个中文字符可以保存，16 个字符通过页面、Server Action 和认证数据库客户端均被拒绝。
- 未完成 onboarding 的成员无法直接读写课程、选课、课程群或消息表。
- 已完成成员可以访问 `/profile`，修改名称后再次读取即为最新值。
- 头像仅展示已有 `avatar_url`；本 Ticket 没有开放 URL 编辑或文件上传。

## 本地验证顺序

```bash
npm test
npm run build
npm run lint
npm run typecheck
```
