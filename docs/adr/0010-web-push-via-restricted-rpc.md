# 网页推送：服务端持有 service_role，但只调用三个受限函数

私聊新消息和好友申请需要提醒不在页面上的收件人。发送器要读**别人**的推送订阅，而发消息的是普通登录用户，RLS 不允许他读。

## 决定

- 订阅存在 `push_subscriptions`，对 `anon`/`authenticated` 完全不可读写；成员只能经 `save_push_subscription` / `remove_push_subscription` 管理自己的订阅。
- 服务端发送器用 `SUPABASE_SERVICE_ROLE_KEY` 调用两个"认领"函数 `claim_push_targets_for_direct_message(消息 id)` 与 `claim_push_targets_for_friend_request(申请 id)`，以及清理失效订阅的 `drop_push_subscription`。**只授权给 `service_role`**，与课程截图识别额度函数（Issue #50）是同一种模式。
- 认领函数**自己从数据库推导收件人**，调用方只能给事件 id，不能指定"发给谁"。函数复查：事件刚发生（5 分钟内）、关系仍有效（好友未解除、未拉黑任一方向、收件人没有屏蔽发送者）、收件人已完成资料。通过后在 `push_dispatches` 里原子登记，同一事件只会通知一次，重试和重复提交不会重复推送。
- 通知正文是固定文案（"你有一条新消息"），不含内容和发送者，因为锁屏上谁都看得到。课程群聊不推送。
- 推送是附带功能：在响应之后（`after`）发送，任何失败都被吞掉，不影响发消息或发好友申请。推送服务返回 404/410 时清掉该订阅。
- 配置分四项（`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`SUPABASE_SERVICE_ROLE_KEY`），缺任何一项整体关闭：发送器不动作，资料页不显示开关。所以代码可以先于数据库迁移和密钥发布。

## 代价与边界

- 生产第一次出现 `service_role` 密钥。它绕过 RLS，只能在 `server-only` 代码里使用（`src/features/push/production-push-notifier.ts`），不能加 `NEXT_PUBLIC_` 前缀，不给协作者。用法被限制在上面三个函数上，不用它做任何别的查询。
- 一个登录用户拿不到别人的订阅：订阅表不可读，认领函数不对登录用户开放。
- iPhone 必须先把网页添加到主屏幕才有推送能力（iOS 16.4+）。

## 启用步骤

见 [推送运维手册](../runbooks/web-push.md)：先应用迁移，再配四个环境变量，最后发布。
