# 当前状态

核对日期：2026-09-12。代码基线：PR #24 的 `2e3da19` 与原 `main` 的 `2b3cb4e` 整合结果。
本次已核对本地完整迁移测试、GitHub、Vercel 配置与生产数据库结构；生产仅做只读盘点，未应用迁移。

## 代码已实现

| 模块 | 范围 |
|---|---|
| 认证与资料 | 学校精确邮箱域名、六位 OTP、成员绑定、会话与当前设备退出；首次登录强制补全资料 |
| 课程 | 大厅搜索、加入退出、课程群聊、历史分页、Realtime 与断线补拉、旧学期归档；课程会话改为学生首次加入时才创建（见 [ADR-0007](adr/0007-lazy-course-conversation-creation.md)） |
| 好友与私聊 | 好友申请、备注、隐藏、删除、双向拉黑；私聊、未读、已读位置与个人历史清除 |
| 可靠发送 | 课程与私聊共用发送 RPC、客户端 UUID、幂等约束、失败保留与重试、响应和 Realtime 去重 |
| 举报与清理 | 行为举报、不可变证据、举报消息保留；双方清除满 720 小时后的受控物理清理，默认 dry-run |
| 平台管理 | `/admin`、所有者与管理员、学校域名、课表导入、学期切换与审计；管理员跨校测试（课程、好友与私聊按当前学校判断，见 [ADR-0006](adr/0006-admin-cross-school-testing.md)） |

学习搭子、笔记共享尚未开发；举报证据已实现不代表内容审核后台已交付。

## 生产发布暂停与待办

- **Vercel Git 集成已连接，生产分支是 `main`。** 当前生产 deployment 为 `dpl_GRDM8T2uzj4VqswkCnHT1JVfochf`，提交 `2b3cb4e`。此前“未连接”的记录已过时。
- **新版已上线（2026-09-12）**：从 `main` 的 `4607e6e`（PR #25）手动 `vercel deploy --prod`，生产 deployment 为 `dpl_9i1xfZpdyp9fcJ648RMbLTdnZ5Zu`。上一版 `dpl_GRDM8T2uzj4VqswkCnHT1JVfochf`（`2b3cb4e`）是前端回滚目标；回滚前端不会回滚数据库。未登录冒烟通过，登录后的完整验收仍待进行。
- **`vercel.json` 仍暂停 `main` 的 Git 自动部署**：合并代码不会自动上线，发布需要手动 `npx vercel deploy --prod`。数据库已与代码一致，是否单独提交解除暂停待决定，按[部署手册](runbooks/deploy.md)。
- **生产数据库已迁移（2026-09-12）**：发布前只读盘点确认生产结构对应前 11 条迁移（见[发布盘点](handoffs/release-preflight-20260912.md)），随后 9 条待执行迁移 `202609100006`–`202609120002` 已按顺序在生产执行，每条单独一个事务；执行前实测过失败会整体回滚、执行角色为 `postgres`。执行后核对：表 29 张，未登录只能执行 `enabled_school_id_for_email_domain`，两张限流表 RLS 保留，Realtime 仍包含 `messages`，原有各表行数不变。迁移历史表已建立并登记全部 20 条，今后 `db push` 可正常判断。详见[发布记录](handoffs/release-20260912.md)。
- **生产没有平台备份**（免费版，备份列表为空）。本次执行前导出了 public 全部数据到仓库外 `D:/Projects/self_Project/CourseMate-backups/`，并用该副本在 PGlite 完整演练 9 条迁移。两张限流表的 RLS 仍只存在于线上，需补一条迁移声明。
- 本地、Vercel 预览与生产均连接同一 Supabase 项目；localhost 调试写操作也会影响该数据库。升级演练需隔离环境。两校当前学期均为 `2026-fall`。9 月 12 日迁移前的生产数据：成员 4 人、资料 3 份、课程目录与当前学期课程各 24 门、消息与好友关系均为 0。完整课表仍待提供并预演。
- 所有者初始化、正式课程数据导入、生产 Realtime、多浏览器会话与 PostgreSQL 多连接竞争仍待验收；**Issue #19 保持未完成**。认证剩余边界见 Issue #7。
- **课程会话惰性创建迁移已上生产（2026-09-15）**：`202609140001_lazy_course_conversation_creation.sql` 把课程会话创建时机从"建课/物化目录时"改为"第一个学生加入时"。应用时确认清理了 23 个此前"建课时就建、但从来没人加入过"的空课程会话（清理前只读核对过：这些行只有 `conversation_id`/`course_id` 关联，不含任何成员或消息数据）。
- **权限收口迁移已上生产（2026-09-15）**：`202609150001_permission_hardening.sql`——补声明两张限流表已在线上生效的 RLS、收回 11 个内部触发器函数的 `PUBLIC`/`anon`/`authenticated` 执行权（含推翻 `202609100005` 当时对触发器函数"怕影响触发"的保留意见，见 [ADR-0008](adr/0008-permission-hardening-and-direct-message-visibility.md)）、把新表默认权限改成对 `anon`/`authenticated` 不可见、收回 `messages` 表的直接 `insert/update/delete`（此前课程消息能绕开可靠发送 RPC 的幂等 UUID 直接写表）、私聊 `messages` 的 SELECT 策略补上个人清除游标（此前直接查表能看到自己已清除的私聊历史）。同时新增 `supabase/templates/course-catalog-import.sql`（数据只写、不建表不改权限的直连兜底导入模板，配套 `docs/runbooks/seed-courses.md` 新增小节）、`supabase/preflight/permission-hardening-check.sql`（只读复查脚本），并修正了 `docs/runbooks/new-supabase-project.md` / `platform-admin.md` 里"SQL Editor 不按事务执行"被当成 PostgreSQL 通用行为的说法——已用 `supabase db query --linked` 直连做过对照实验，`begin/commit` 在直连场景下正常生效，只是 Studio 网页版 SQL Editor 这个工具不会把粘贴内容当一个事务跑。
  - 本次同时诊断了一条 SQL Editor"建了个叫 `the` 的表、未开 RLS"的警告：核实是纯 `INSERT ... ON CONFLICT` 语句，Studio 的检测把课程简介英文原文里的"…into the…"误判成了 `SELECT INTO 新表`，不是真的建表；应用前后都用 `to_regclass('public.the')` 确认过不存在这张表。
  - **应用前的本地验证**：完整迁移链测试通过（74 个测试文件、448 项测试）及构建、lint、类型检查依次通过。
  - **应用方式与结果**：经 MCP `apply_migration`（等同直连执行，非 Studio 网页版 SQL Editor）依次应用 `202609140001`、`202609150001`，均成功；应用后用 `permission-hardening-check.sql` 复核：两张限流表 RLS 为 `true`，11 个触发器函数均不再对 `anon`/`authenticated` 开放执行权，`messages` 只剩 `authenticated` 的 `select`，`messages_select_direct_member` 策略已带清除游标条件，`messages_insert_active_course_member` 策略已不存在，遗留空课程会话为 0。官方 security advisor 复查：`anon` 可执行的 `SECURITY DEFINER` 函数从 8 个降到 1 个（只剩登录前必需的 `enabled_school_id_for_email_domain`）。迁移历史表里这两条的 `version` 已从 `apply_migration` 自动生成的时间戳（`20260915051335`/`20260915051431`）改回和仓库文件名一致的 `202609140001`/`202609150001`，避免以后 `db push` 误判成未应用；这次改动本身多留了一条 `20260915051655`/`reconcile_migration_history_versions` 记账行，不对应仓库里的迁移文件，下次核对迁移历史时留意。
  - **物化 uw-madison 课表**：应用后调用 `materialize_catalog_courses('uw-madison')`，结果 `2026-fall` 学期新建 3,900 门、已存在 24 门、不合规 0 门——此前绕过 `/admin` 直接导入 `course_catalog` 的那 3,924 行现在都已经是当前学期学生可以搜到、加入的课程；umich 的 `course_catalog` 目前是 0 行，没有需要物化的数据。
  - **没有做的事，且这次没能补上**：应用迁移前尝试导出全表数据做备份（延续 9/12 的做法），但对 `member_accounts`/`profiles`/`messages` 这类含真实邮箱和消息正文的表做批量导出被会话自身的权限分类器拦下（PII 处理），没有强行绕过。改为先只读核对了这次迁移实际会删除的数据范围（上面提到的 23 行空会话，不含个人信息），确认残余风险很低后才应用。**生产仍然没有平台级备份**，建议尽快由能拿到数据库连接串的人手工跑一次 `supabase db dump --linked -f backup.sql`（或等价的 `pg_dump`），这次没有生成新的全量备份文件。
- 生产消息清理调度保持未启用；本次没有删除生产消息、测试身份或其他数据库数据。
- `src/types/database.ts` 已从迁移后的生产库重新生成（2026-09-15，`202609140001`/`202609150001` 应用之后），与本地完整迁移链的表、函数集合一致；`create_conversation_for_course` 已从中移除，新增 `direct_message_clear_position`。
- 网站启动和按钮响应慢的问题此前仅做初步诊断，尚未实施页面性能优化；本次合并不代表该问题解决。
- 分支保护、Code Owners 强制审核与协作者后台权限仍需按实际设置核实；试点学校、定位与双语方案待决定。

2026-09-12 在 `codex/admin-school-testing` 上实际运行：73 个测试文件、444 项测试及构建、lint、类型检查依次通过。PR #24 整合的验证范围见[整合交接](handoffs/pr24-integration.md)，跨校测试见[跨校测试交接](handoffs/admin-school-testing.md)。历史交接里的测试数字和线上状态仅代表当时。

## 如何更新

交付、待办完成或环境核实后，只更新这里对应的状态、日期与证据。稳定规则放 `CONTEXT.md` / ADR，操作步骤放 runbook，当时的实现与验证保留在 handoff。
