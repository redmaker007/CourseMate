# 统一会话核心交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

Issue #12 将原有课程群存储迁移到统一会话核心。本次只提交 migration、数据库类型和自动化测试，**没有向任何托管 Supabase 项目应用 migration**。

## 数据模型

- `conversations` 保存所有会话共有的类型、创建时间和归档时间。
- `course_conversations` 保证一门课程只对应一个课程会话。
- `direct_conversations` 以排序后的成员对保证两名成员之间最多一个私聊；账号删除时成员引用置空，不级联删除会话。
- `conversation_members` 保存成员资格以及每名成员自己的已读、清除游标。游标外键保证它们只能指向同一会话中的消息。
- `messages` 原表原地把 `group_id` 改为 `conversation_id`，按 `(conversation_id, id desc)` 分页；发送者注销后继续置空并保留历史。

## 迁移保证

Migration `202609100001_unified_conversation_core.sql` 在同一事务中：

1. 快照旧消息并把课程群 UUID 直接复用为课程会话 UUID。
2. 复制群成员，原样保留消息 ID、发送者、正文、时间和软删除状态。
3. 比较会话数、成员集合和消息全集；任何断言失败都会回滚，旧表不会删除。
4. 推进消息 identity sequence，避免显式导入过历史 ID 后产生倒退的新游标。
5. 删除 `groups`、`group_members` 及旧触发器，课程生命周期只维护统一模型。

`messages` 表本身没有重建，因此已有 `supabase_realtime` publication 注册会继续保留，不会重复添加。

## 权限边界

- 匿名用户、未完成 Profile onboarding 的成员和非课程成员不能读写课程会话。
- 活跃课程会话的成员可以读取和发送；归档后仍可读取历史和成员列表，但不能发送。
- 客户端没有消息 UPDATE/DELETE 权限。
- 私聊结构已经可供后续事务使用，但本 Ticket 不授予客户端读取或写入权限；#14 创建好友私聊，#16 开放私聊消息行为。

## 后续 Ticket

- #13 设置课程会话归档生命周期。
- #14 在接受好友申请的事务中创建唯一私聊会话。
- #16 实现私聊消息、已读和个人清除行为。

## 本地验证

```bash
npm test
npm run build
npm run lint
npm run typecheck
```
