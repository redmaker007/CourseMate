# 站内行为举报与证据快照交接

Issue #18 在好友申请、私聊消息和成员资料上增加了统一举报能力。本次提交包含 migration、服务端入口、页面入口和自动化测试，但不会关闭 Issue；最终严格 code review 仍统一在后续进行。

## 核心数据流

1. 页面只提交目标类型、目标 ID、举报原因和可选说明。
2. Server Action 重新检查登录和 onboarding，并把输入交给举报服务校验。
3. `create_behavior_report` 在同一个数据库事务中确认目标可见、推导被举报人、生成当时的证据快照，并写入留存关系。
4. 普通成员只能读取自己的举报记录；证据和留存表没有成员读取入口。

## 数据职责

- `behavior_reports`：举报人的提交内容和 `pending / dismissed / actioned` 状态。
- `report_evidence`：数据库生成的被举报人和不可修改快照，不包含学校邮箱或认证数据。
- `report_source_retention`：告诉后续物理清理任务哪些原始内容关联了举报。
- `reporting-service.ts`：目标 ID、原因和 1000 字符边界的应用层校验。
- `supabase-reporting-backend.ts`：唯一数据库适配入口，不接受 actor、被举报人或客户端快照。
- `ReportForm`：好友申请、消息和成员资料复用的轻量举报表单。

## 权限与失败情况

- 行为主体始终来自 `auth.uid()`，客户端无法伪造举报人或证据。
- 不完整 onboarding、不可见目标、自我举报和不合法说明都会在数据库边界再次拒绝。
- 同一举报人对同一目标只能有一个 `pending` 举报；重试返回原举报 ID。
- 举报只写举报相关表，不会自动拉黑、删除好友、隐藏内容或处罚用户。
- 源消息、资料或账号以后发生变化时，证据快照和主体 UUID 仍保留。

排查问题时，先看页面提交字段与 `reporting-service.ts` 的校验结果；若返回 `not_available`，再检查 migration 中对应目标的可见性条件；若涉及证据或重复记录，直接检查数据库 RPC 和三个举报表之间的事务关系。
