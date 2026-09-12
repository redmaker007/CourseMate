# Issue #23：聊天发送验收记录

## 远程请求次数

- 课程群聊改造前：Server Action 发送路径共 7 次 Supabase 请求（身份与 onboarding 2 次、成员/会话/归档检查 3 次、写入 1 次、发送者资料 1 次）。
- 课程群聊改造后：1 次 `send_conversation_message` RPC。
- 私聊改造前：Server Action 发送路径共 3 次 Supabase 请求（身份与 onboarding 2 次、发送 RPC 1 次），成功后浏览器还会额外请求一次历史回填。
- 私聊改造后：1 次 `send_conversation_message` RPC；RPC 直接返回完整消息，不再成功后回填。

以上是按改造前后代码路径统计的网络请求数，不是生产环境延迟基准。

## 验证结果

- 全量测试：64 个测试文件、371 个测试通过。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 已覆盖两种返回顺序、重复同步去重、多条失败消息保留、重试复用 UUID、数据库幂等冲突及权限边界。

## 部署提醒

本地联调库已应用 `202609120001_reliable_message_sending.sql`。生产数据库未修改；部署新前端前必须先应用该迁移。
