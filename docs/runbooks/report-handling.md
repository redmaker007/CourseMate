# 处理举报

2026-11-23 用户决定：

- **谁处理**：全体平台管理员（`platform_roles` 里的 owner 和 admin），暂时不设专人。
- **多久回应**：对外承诺“通常 24–48 小时内查看”。
- **怎么发现新举报**：处理人每天查一次数据库（方案 a），暂时不做邮件提醒或管理后台。
- **证据保留**：举报处理完成一年后删除证据正文（见下文“到期清理”）。

> **前提：** 下面的 SQL 需要能进入 Supabase 项目的 SQL Editor。当前只有项目所有者有这个权限，`/admin` 管理页**看不到举报**。如果“全体管理员”都要参与，要么把他们加进 Supabase 组织（他们会因此看到全部数据），要么以后做管理页的举报列表（之前的方案 c）。决定前，实际上只有项目所有者能处理举报。

证据里有用户原文和资料，只在 SQL Editor 里看，不要复制到群聊、工单、Notion 或截图外传。

## 每天检查

```sql
select r.id, r.created_at, r.target_type, r.reason, r.details,
       e.snapshot ->> 'body' as message_body,
       e.snapshot ->> 'conversation_kind' as chat,
       e.snapshot ->> 'message' as request_note,
       e.snapshot ->> 'display_name' as profile_name,
       e.reported_user_id
from public.behavior_reports r
join public.report_evidence e on e.report_id = r.id
where r.status = 'pending'
order by r.created_at;
```

超过 24 小时还是 pending 的举报优先处理。

## 处理一条举报

1. **判断是否违规**：对照网站 `/terms` 页（源码 `src/app/terms/page.tsx`）第二节社区规范。
2. **违规内容是消息时，删除这条消息**（软删除，所有人都看不到了，证据快照不受影响）：

   ```sql
   update public.messages set deleted_at = now()
   where id = <message_id> and deleted_at is null;
   ```

3. **情节严重时停用账号**：停用功能还在开发，上线后在这里补操作步骤。停用之前，只能删除内容。
4. **更新举报状态**：违规写 `actioned`，不违规写 `dismissed`。数据库会自动记下处理时间，到期清理靠这个时间计算。

   ```sql
   update public.behavior_reports set status = 'actioned'   -- 或 'dismissed'
   where id = '<report_id>' and status = 'pending';
   ```

   多人举报同一目标时，按同一处理结果一起更新这些举报。
5. **回复**：如果举报人通过联系邮箱跟进过，只告诉对方“已处理”，不透露被举报人的处罚细节或个人信息。

## 到期清理（每月一次）

处理完成满一年的举报，删除证据正文，只保留类别和结果。迁移 `202611220003_report_evidence_retention.sql`（PR #67）上线后可用：

```sql
select public.redact_expired_report_evidence();  -- 返回本次清理的条数
```

只有数据库负责人或 service_role 能执行。重复执行是安全的。

## 记录

每天检查完，在团队频道记一笔：日期、处理了几条、是否有停用。不写具体内容。
