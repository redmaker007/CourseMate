# 新版发布：第一步只读盘点

核对日期：2026-09-12。仓库基线 `eb8a86c`；生产前端仍为 `2b3cb4e`，预览构建为 `47d8a34`。
本记录是当时证据；当前进度统一见 [STATUS](../STATUS.md)，后续发布按[部署手册](../runbooks/deploy.md)。

## 结论

生产数据库结构对应前 11 条迁移（截至 `202609100005`），另有两张限流表已开启 RLS。新版后续 8 条迁移尚未具备对应对象，不能直接发布新前端。当前项目不存在 `supabase_migrations.schema_migrations` 表；旧交接“登记前两条”的记录与本次结果不同，本次不推断差异原因，也没有重跑或修复迁移。

本地 `.env.local`、Vercel Production 与 Preview 的公开 Supabase URL 都是 `cqrlxcxcgrcoamqnjkwu.supabase.co`。预览和 localhost 并未隔离数据，调试写操作会作用于同一数据库。升级演练必须另用隔离数据库；本轮没有建立新项目或改变连接。

## 结构与权限证据

使用 PostgreSQL 系统目录 SELECT 读取线上结构，在 PGlite 中独立构建前 11 条和全部 19 条迁移，比较两组 schema。未读取邮箱、成员资料明细或消息正文。线上 PostgreSQL 为 17.6，PGlite 为 18.3；18 的独立 NOT NULL 约束登记不与 17 直接比较，可空性另由列元数据逐项比较。

| 检查项 | 线上 | 与前 11 条迁移比较 |
|---|---:|---|
| 业务表 | 20 | 名称一致；仅下述两张表 RLS 状态不同 |
| 列 | 103 | 类型、可空性、默认值、生成属性一致 |
| CHECK / FK / PK / UNIQUE 等约束 | 89 | 名称、定义、验证状态一致 |
| 索引 | 34 | 一致 |
| RLS 策略 | 21 | 定义和角色一致 |
| 应用触发器 | 12 | 定义和启用状态一致，包含 Auth 用户绑定触发器 |
| public 函数 | 33 | 签名、返回值、正文、security definer、配置及客户端执行授权一致 |
| 客户端/服务角色表级授权 | 199 | 一致 |
| 客户端/服务角色列级授权 | 598 | 一致 |
| Realtime publication | `public.messages` | 已加入；真实订阅体验仍待验收 |

额外保留项：线上 `friend_rate_limit_config`、`friend_rate_limit_buckets` 已启用 RLS，本地迁移未声明。两边均已撤销普通客户端表权限，线上 RLS 是额外保护。后续应通过新增迁移补齐声明，不能为了匹配本地而在线上关闭 RLS。

当前 `postgres` 创建 public 新函数的默认授权已撤销 `anon`/`authenticated`，符合权限修复；`supabase_admin` 仍有另一套平台默认授权。执行迁移时必须核对角色并保留显式 revoke/grant。

这些检查确认当前对象状态，不能复原历史上每条数据迁移的执行过程。历史修复清单需与备份和升级演练一并确认。

## 待执行的迁移

| 版本 | 内容 |
|---|---|
| `202609100006` | 管理角色、管理 RPC 与审计 |
| `202609110001` | 好友页面查询 |
| `202609110002` | 私聊消息、已读与历史清除 |
| `202609110003` | 私聊页面取数 |
| `202609110004` | 举报与证据 |
| `202609110005` | 私聊安全清理基础设施 |
| `202609110006` | 拉黑方向 |
| `202609120001` | 可靠发送与客户端消息 UUID |

相对最终 19 条迁移，线上缺少 8 张表、49 个列、33 个函数签名；3 个现有好友函数需要升级。缺少的表是 `platform_roles`、`admin_audit_log`、`behavior_reports`、`report_evidence`、`report_source_retention`、`direct_message_clear_ranges`、`direct_message_cleanup_eligibility`、`direct_message_cleanup_runs`。这些是整条依赖链，不能只补最后一个发送 RPC。

## 课程数据与聚合检查

- 两校 `uw-madison`、`umich` 的当前学期均为 `2026-fall`。
- `course_catalog`、`courses`、`messages` 当前均为 0 行。
- 不合规显示名称数为 0；已确认邮箱但缺少成员绑定的账号数为 0。
- 好友搜索和申请限流配置均为每分钟 5 次、每小时 30 次，与迁移一致。
- 用户给出的 `ACCT I S 100` / `ACCT I S 211` 两行已用现有 `parseCourseRow` 本地验证通过，保留字符串 ID `002983` / `002984`；`Not Applicable` 转为空值。
- `Term: Fall 2026` 保存到 `source_term`，不会自动改变网站当前学期。实际 `courses.term` 取 `school_term_settings`。
- 九列表头与导入器吻合；完整 `.xlsx` 仍须包含 Index 学科索引及对应院系分页。课程 ID 单元格应保存为文本，数值化丢失的前导零无法从样例外推恢复。当前只验证两行样例，未收到或导入完整课表。

## 下一步

1. 确认可恢复备份与隔离演练环境。
2. 拟定前 11 条的迁移历史修复清单、后 8 条的升级顺序及限流表 RLS 补充迁移。
3. 在隔离环境验证升级和旧前端兼容性，再执行生产变更；当前自动生产部署继续暂停。
4. 准备完整课表先做导入预演；配置所有者后，经管理页导入并生成当前学期课程。

本轮未应用业务迁移、修复历史、导入课程、删除数据、启用清理或发布新版。备份恢复能力、Auth 后台配置和真实多用户/Realtime 流程仍待后续验证。

## 复查入口

只读结构查询见 [release-inventory.sql](../../supabase/preflight/release-inventory.sql)。CLI 使用明确项目标识，避免旧版关联文件兼容差异：

```bash
npx supabase db query --linked --project-ref cqrlxcxcgrcoamqnjkwu --file supabase/preflight/release-inventory.sql --output json
```

本轮原始结构快照与本地对比结果保存在仓库外的 `D:/Documents/ChatGPT/CourseMate/release-inventory-*.json`，不包含业务行内容，也没有上传 GitHub。连接核对仅读取公开 Supabase URL 变量，未输出 key 或密码；Vercel 接口见[官方说明](https://vercel.com/docs/rest-api/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id)。
