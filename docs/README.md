# 任务与代码索引

先定位任务，再读对应文档和文件。已在本次上下文中读过且未变化的内容无需重复读取。

## 最小阅读路径

- 只需了解项目：根目录 [CONTEXT.md](../CONTEXT.md) 与 [STATUS.md](STATUS.md)。
- 修改或排障：下面对应的一行 → 相关 ADR → 代码入口及相邻测试；追查原因时再打开 handoff。
- 运维操作：直接打开根目录 [README 的操作手册索引](../README.md#操作手册)中对应的一份；涉及多个步骤时再沿链接扩展。
- 接手 Issue：先读该 Issue 的最新正文与评论，再使用本表定位；不批量加载所有历史工单。

## 按任务定位

以下源码路径相对于仓库根目录；先搜函数名或读目标段落，再按依赖扩大范围。

| 任务 | 首读文档 / 决策 | 代码入口 |
|---|---|---|
| OTP、登录、退出、学校准入 | [认证规格](specs/auth-email-otp.md)、[ADR-0001](adr/0001-separate-member-account-from-profile.md)；实测验收看 Issue #7 | `src/features/auth/`；`src/lib/supabase/`；`src/proxy.ts` |
| 资料保存、首次登录卡住 | [ADR-0004](adr/0004-require-profile-onboarding-for-app-access.md)；权限事故见[课程整合交接](handoffs/course-catalog-integration.md)“新成员卡在 onboarding” | `src/features/profile/`；`src/app/onboarding/profile/` |
| 搜课、加退课、课程消息 | [统一会话交接](handoffs/unified-conversation-core.md)；课程来源见[录入课程](runbooks/seed-courses.md) | `src/features/courses/`；`src/app/dashboard/`；`src/app/courses/`；`src/app/api/courses/` |
| 好友、拉黑、私聊与可靠发送 | [好友页面](handoffs/friend-pages.md)、[第一阶段联调](handoffs/phase-one-integration.md)、[可靠发送验收](testing/issue-23-message-send.md) | `src/features/friends/`；`src/features/messages/`；`src/app/messages/` |
| 举报、证据与私聊清理 | [举报交接](handoffs/behavior-reporting.md)、[清理交接](handoffs/direct-message-cleanup.md) | `src/features/reporting/`；`scripts/direct-message-cleanup.mjs`；`supabase/migrations/` |
| 管理身份、学校、学期、录课 | [ADR-0005](adr/0005-platform-roles-and-admin-functions.md)、[管理手册](runbooks/platform-admin.md) | `src/features/admin/`；`src/app/admin/`；`supabase/migrations/202609100006_platform_admin.sql` |
| xlsx 解析或导入脚本 | [录入课程](runbooks/seed-courses.md)；申请数据前读 [ADR-0002](adr/0002-do-not-reverse-engineer-university-course-search.md) | `scripts/course-catalog-parse.mts`；`scripts/import-course-catalog.mts`；`src/features/admin/components/catalog-import.tsx` |
| 大厅与页面布局 | [协作约定](../CONTRIBUTING.md)、[路由交接](handoffs/frontend-routing-and-dashboard.md) | `src/app/**/page.tsx`；`src/features/*/components/` |
| schema、RLS、函数权限 | [数据库说明](../supabase/README.md)、[新建项目手册](runbooks/new-supabase-project.md)及相关业务 ADR | `supabase/migrations/`；集成验证见 `phase-one-integration.test.ts` 与 `platform-admin.test.ts`（自动加载全部 SQL 迁移） |
| 环境、部署、收不到验证码 | 对应[操作手册](../README.md#操作手册)；需要当时证据再看[环境交接](handoffs/environment-and-deployment.md) | `.env.example`；`supabase/config.toml`；`supabase/templates/email-otp.html` |

## 架构边界与已知陷阱

- 页面负责路由和取数；feature 的 service / adapter / actions / queries 负责业务与数据。认证 service 返回结果，页面或功能包装层决定跳转。
- `member_accounts` 保存身份与学校归属，`profiles` 保存公开资料；进入主应用必须完成 onboarding。邮箱不作为公开成员资料。
- `course_catalog` 是无学期目录，`courses` 是带学期课程；`school_term_settings` 是当前学期唯一来源。加退课同步会话成员，学期切换归档旧课程会话。
- 资料保存保留“先 insert，唯一键冲突再 update”；好友模块的列权限会让 upsert 失败。变更权限时检查所有相关读写与完整迁移链路。
- 管理写入经固定 RPC，数据库函数校验身份并记审计；内部函数不向客户端授权。不要靠隐藏按钮代替授权。
- xlsx 解析器由浏览器和 CLI 共用，不能引入 Node 专属依赖；浏览器每 200 门分批写入。
- SQL Editor 执行曾发生非原子迁移事故。手工执行有报错就停下核实；直连或 CLI 迁移前先按手册核对迁移记录。
- 历史文档曾写“学生手动建课”“Profile 可缺失”“尚无业务页面”；当前分别按课程流程、ADR-0004 和实际路由判断。发现其他冲突需说明，不能静默覆盖 ADR。

## 文档职责

| 内容 | 唯一维护位置 |
|---|---|
| 业务术语 / 架构决策 | `CONTEXT.md` / `docs/adr/` |
| 当前进度、待办和验证状态 | `docs/STATUS.md`，注明日期与证据 |
| 具体操作步骤 | `docs/runbooks/` |
| 当时的实现、事故经过和验证证据 | `docs/handoffs/`，保留历史，不作为实时状态 |
| 文件定位 / 协作流程 | 本索引 / `CONTRIBUTING.md` |

新增模块时补本表对应的一行；不要为每个任务复制整份项目介绍。变更文档后检查相对链接与路径；代码验证顺序以[本地开发手册](runbooks/local-development.md)为准。
