# 好友发现与关系状态后端交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

Issue #14 在统一会话核心之上加入好友发现、申请、关系偏好与拉黑规则。本次提交只包含代码和 migration，未向托管 Supabase 项目应用 migration。

## 模块边界

- `friendship-service.ts` 是页面与 Server Action 使用的稳定接口，负责邮箱、UUID、申请附言和备注的服务端校验，并把底层异常收敛为不含敏感信息的状态。
- `supabase-friend-backend.ts` 是 Supabase Adapter，只调用受限 RPC 并把数据库字段映射成领域视图。
- migration 中的 RPC 从 `auth.uid()` 取得行为主体；调用方不能提交 requester、recipient owner 或 blocker 身份。
- 页面属于 #15，普通私聊发送、读取、未读和 Realtime 属于 #16，本 Ticket 没有提前开放这些权限。

## 数据模型

- `friend_requests` 永久保存申请附言、原始时间和最终状态；`friend_request_active_pairs` 单独约束无序成员对只有一份未过期申请，避免依赖包含 `now()` 的不稳定部分索引。
- `friendships` 以无序成员对作为唯一身份，删除好友只把关系置为 inactive；重新接受申请时恢复同一行。
- `friend_preferences` 保存每一端私有的备注和隐藏状态。删除好友时双方偏好都会清除。
- `member_blocks` 保存单向拉黑；查询发送资格时检查两个方向。
- `messages.source_friend_request_id` 唯一关联申请。接受事务重试不会重复插入附言；重新加好友会在原会话追加新申请的附言。

## 接受申请事务

`respond_to_friend_request` 会锁定申请并在同一事务中重新检查接收者、过期时间、学校和双向拉黑，然后：

1. 创建或恢复唯一好友关系；
2. 创建或复用无序成员对的唯一私聊；
3. 以申请原始创建时间插入可追溯的首消息；
4. 结算申请状态并释放有效申请槽位。

数据库唯一约束保证并发和动作重试不会产生重复申请、好友、私聊或来源消息。

## 搜索与限流

`find_member_by_email` 在 `SECURITY DEFINER` 内精确匹配规范化邮箱，但从不返回邮箱。非好友只获得头像、显示名称和当前学期共同课程；好友额外获得完整公开 Profile。

搜索和申请分别使用数据库原子固定窗口计数。默认限制存放在 `friend_rate_limit_config`：每分钟 5 次、每小时 30 次。计数身份来自 `auth.uid()`，因此多应用实例共享同一限制且客户端不能伪造身份。修改配置需使用受信任的迁移或管理连接；普通认证客户端没有表权限。

## 部署后检查

- 未完成 onboarding、跨校成员和匿名客户端不能搜索或操作关系。
- 300 个中文字符的申请附言可保存，301 个被服务端和数据库拒绝。
- 15 个中文字符的备注可保存，16 个被拒绝；清空后立即回退到对方最新显示名称。
- 普通客户端不能查询 `auth.users`，搜索结果、错误和应用日志不得包含目标邮箱。
- 删除好友后历史消息与私聊仍存在；重新添加复用同一私聊且不恢复旧备注。

## 本地验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
