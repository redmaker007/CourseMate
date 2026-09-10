# 好友操作页面交接

Issue #15 在 #14 的好友关系后端之上提供 `/friends`、`/friends/filtered` 和课程成员申请入口。本次提交包含页面、Server Actions 和一条只读查询 migration；尚未把新 migration 应用到托管 Supabase。

## 模块边界

- `/friends` 是普通工作区：精确邮箱发现、收到/发出的申请及历史、普通好友列表、备注、屏蔽、拉黑和删除好友。
- `/friends/filtered` 单独展示被当前成员屏蔽的好友、当前成员主动拉黑的成员，以及由对方设置而仍生效的联系限制。
- `/friends/add?memberId=...` 复用同一申请 Action，课程页面只传成员 ID，不查询或传递邮箱。
- `actions.ts` 把所有表单视为不可信入口：每次重新读取完整 Member Session，再调用 #14 的 service，并把错误收敛为有限的 UI 状态。
- `friend-workspace.tsx` 只维护表单草稿和即时字符计数；关系、权限和最终状态仍由数据库拥有。

## 隐私与状态流

1. 邮箱只存在于浏览器当前表单的 POST 数据中；Action 返回的 discovery view 不含邮箱，页面不使用 URL 查询参数、持久化存储或日志记录邮箱。
2. Server Action 成功后同时 revalidate `/friends` 和 `/friends/filtered`，页面重新从 service 读取数据库事实。
3. 屏蔽是当前成员私有的列表偏好；拉黑是双方发送资格都会感知的联系限制。UI 文案和操作入口明确区分两者。
4. 删除好友的确认文案说明只解除关系、不替对方删除历史；会话链接统一使用 #17 约定的 `/messages/[conversationId]`。

## 新增只读 RPC

`202609110001_friend_page_queries.sql` 新增 `list_blocked_members()`，只从 `auth.uid()` 返回当前成员自己创建的拉黑记录、有限 Profile 和已有会话 ID，不返回邮箱。它补足了 `list_friends(true)` 无法列出被主动拉黑的非好友这一读模型缺口。

部署 migration 后需从目标 Supabase 重新生成 `src/types/database.ts`；当前没有手工修改该生成文件。

## 排障顺序

1. 页面整体无法进入：先检查 `getCurrentMember()` 和 onboarding 状态。
2. 单个操作失败：检查 Action 返回的受限状态，再检查 friendship service 的输入校验。
3. 页面刷新后状态不对：检查 #14 RPC 和 `list_blocked_members()`，数据库/RLS 是最终事实来源。
4. 会话不能发送或未读异常：属于 #16/#17 的消息资格和未读链路，不应在好友页面中绕过。
