# 平台角色与管理页交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

新增三级平台身份（普通成员 / 管理员 / 所有者）与 `/admin` 管理页。团队成员不进 Supabase 后台，就能录课、切换学期、管理开放学校。

- 为什么这么设计：[ADR-0005](../adr/0005-platform-roles-and-admin-functions.md)
- 怎么操作：[管理页与平台角色](../runbooks/platform-admin.md)

---

## 当前状态

| 项 | 状态 |
|---|---|
| 代码 | `feature/platform-admin` 已快进合并进 `main`，已部署到生产环境 |
| Migration `202609100006_platform_admin` | **待在 SQL Editor 执行** |
| 所有者 | **待指定**（runbook「指定所有者」） |
| Migration 执行前的线上表现 | 无害：大厅不显示管理入口，`/admin` 显示 404。代码把「函数不存在」当作没有身份处理 |

所以部署与 migration 的先后顺序在这次无所谓，这是刻意做成的：读身份失败一律按没有身份处理。

---

## 改了什么

### 数据库（`202609100006_platform_admin.sql`）

- `platform_roles`：身份表，挂在 `member_accounts` 上。部分唯一索引保证只有一位 owner。
- `admin_audit_log`：操作记录。
- 两张表对客户端完全关闭：不授权、不建策略。
- 内部辅助函数（不授予任何客户端角色）：`require_platform_role(minimum)`、`write_admin_audit(...)`。
- 对客户端开放的 14 个函数，全部只授予 `authenticated`：

| 函数 | 最低身份 |
|---|---|
| `current_platform_role()` | 任何登录成员（只返回自己的身份） |
| `admin_list_schools()` / `admin_list_staff()` / `admin_list_audit_log(max_rows)` | admin |
| `admin_set_current_term(school, term)` | admin |
| `admin_import_catalog_batch(school, entries)` / `admin_materialize_catalog(school)` / `admin_save_catalog_course(school, code, title)` | admin |
| `admin_save_school` / `admin_set_school_enabled` / `admin_add_school_domain` / `admin_remove_school_domain` | owner |
| `admin_grant_admin(email)` / `admin_revoke_admin(user)` | owner |

### 应用

- `src/features/admin/`：身份读取与页面门禁（`queries.ts`）、Server Actions（`actions.ts`）、错误翻译、操作记录格式化、各个组件。
- `src/app/admin/page.tsx`：管理页。
- 大厅页头：有身份的成员多一个「管理」按钮（`dashboard-header.tsx` 的 `adminHref`）。
- `src/types/database.ts`：**手工补了新函数的类型**，因为 migration 还没在线上执行，没法从线上重新生成。

### 课表解析器

整本工作簿的解析从导入脚本里抽成 `parseCatalogWorkbook()`，放在 `scripts/course-catalog-parse.mts`，命令行脚本与管理页共用。用 fixture 对比过，重构前后脚本的输出逐字一致。

---

## 改代码之前必须知道的

1. **授权在数据库函数里，Server Action 不重复校验。** 每个管理函数第一句是 `require_platform_role(...)`。不要为了管理员去给表加写入的 RLS 策略——那会绕开函数里的校验和操作记录。
2. **错误约定。** 函数里 `errcode = '22023'` 的提示是写给管理员看的，页面原样展示；`42501` 是没有权限；其他错误页面一律显示「操作失败」，不透出原文。新写的校验要用 22023，否则用户只会看到笼统的失败提示。
3. **课表在浏览器里解析。** Server Action 默认只收 1MB 请求体，Vercel 的硬上限是 4.5MB，整份课表可能超过。所以浏览器解析后每 200 门一批发送。**解析器里不能引入任何 Node 专属的东西**，它会被打包进浏览器。
4. **exceljs 在浏览器里是动态加载的**，打包器给的导出形态不固定，`catalog-import.tsx` 里同时兼容命名空间和 `default` 两种。
5. **读身份失败按没有身份处理。** `/admin` 对没有身份的人显示 404，不暴露页面存在。
6. **只有一位 owner，网站上撤不掉 owner**，避免把自己锁在门外。
7. **执行 migration 之后，要从线上重新生成 `database.ts`。** 手工补的类型里 `| null` 标注在重新生成后会消失，代码里已经用 `??` 兜底，不受影响。
8. **新增管理函数照同一个模板写**：第一句 `require_platform_role`，结束前 `write_admin_audit`，`revoke all … from public, anon, authenticated` 再 `grant execute … to authenticated`，面向管理员的校验用 22023。

---

## 验证了什么

| | |
|---|---|
| 全量测试 | **320 项通过**，lint、生产构建、类型检查通过 |
| 数据库 | `supabase/migrations/platform-admin.test.ts`，27 项。PGlite 按真实顺序跑完全部 12 个 migration：未登录用户执行不了任何管理函数；内部辅助函数对客户端不开放；普通成员一律被拒；只能有一位 owner；admin 与 owner 的边界；每一类操作的正常路径、校验提示与操作记录；切换学期后旧会话归档、新学期课程物化 |
| 函数执行权枚举 | `course-catalog-integration.test.ts` 的链路接上了新 migration，「未登录用户只能执行 `enabled_school_id_for_email_domain`」的检查覆盖到新函数 |
| 应用 | 页面门禁（含读身份失败按没有身份处理）、所有者 / 管理员各自看到哪些表单、大厅的管理入口、课表导入组件（用 exceljs 生成真实 xlsx 测试） |
| 真浏览器 | 用临时页面在开发服务器上跑通：打包后的 exceljs 浏览器版本能加载；fixture 的报告与命令行预演逐字一致；按批写入、写完触发物化；控制台无报错。临时页面已删除 |

### 没验证的

- **Migration 还没在线上执行**，所以真实 PostgREST 调用没有跑过：参数名、`22023` 提示能否原样传到页面，都是第一次真实使用时才会验证。
- 真实规模的官方课表（几 MB）在浏览器里的解析耗时。
- 登录后的整套管理页没有由真人点过。

---

## 需要协调的事

- 执行 migration、指定所有者、任命组员为管理员之后，组员日常录课改用 `/admin`，不再进 Supabase 后台。**确认管理页可用后，建议把组员移出 Supabase 组织**，见 runbook 第 4 步。
- `main` 又更新了，组员继续开发前要先合并 `main`。
- 组员以后如果要写新的管理功能，照上面第 8 条的模板写。
