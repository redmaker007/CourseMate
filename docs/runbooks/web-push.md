# Runbook：启用网页推送

> 背景与权限边界见 [ADR-0010](../adr/0010-web-push-via-restricted-rpc.md)。代码缺任一环境变量时推送整体关闭，所以顺序错了也不会出事，只是不生效。

## 顺序

1. **应用迁移** `202610040001_web_push.sql`（新项目 `xpmkpkplftgtfzecdwpd`）。`supabase/.temp/project-ref` 可能还指着旧项目，使用 `--linked` 前先 `supabase link`。应用后补登记迁移历史，并重新生成 `src/types/database.ts`。
2. **生成 VAPID 密钥**（只在自己机器上跑一次，输出别贴到聊天或日志里）：

   ```bash
   npx web-push generate-vapid-keys
   ```

3. **在 Vercel 配四个环境变量**（Production；Preview 按需）：`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`（`mailto:` 加你的联系邮箱）、`SUPABASE_SERVICE_ROLE_KEY`（新项目的 service_role key，Supabase 后台 Settings → API）。这四个都不加 `NEXT_PUBLIC_`；私钥和 service_role 标 Sensitive，公钥和 subject 可以标 Config。
4. **发布前端**（`npx vercel deploy --prod`）。环境变量改动必须重新部署才生效。
5. **验收**：用 Android Chrome 或已添加到主屏幕的 iPhone，在「我的」页点「开启通知」；换另一个账号给你发私聊，应在锁屏收到「你有一条新消息」；点击进到该会话。拉黑、屏蔽对方后不应再收到。

## 排障

- 「我的」页没有「新消息通知」卡片：四个变量缺项，或还没重新部署；iPhone 需要从主屏幕打开。
- 收不到：看 Vercel 函数日志；确认 `push_subscriptions` 里有该成员的行；浏览器通知权限是否被系统关闭。
- 订阅被推送服务判为失效（404/410）会自动删除，重新点一次「开启通知」即可。
