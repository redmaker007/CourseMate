# 当前状态

核对日期：2026-09-25（生产数据库搬迁）；代码状态核对于 2026-09-20，基线 `feature/issue-29-course-member-relationships`，基于 `main` 的 `33c6f91`。
本页区分代码基线与生产状态；生产状态以下方带日期的条目为准，其中 2026-09-25 的搬迁条目是当前生产数据库的起点。

## 代码已实现

| 模块 | 范围 |
|---|---|
| 认证与资料 | 学校精确邮箱域名、六位 OTP、成员绑定、会话与当前设备退出；首次登录强制补全资料 |
| 课程 | 大厅搜索、加入退出、课程群聊、历史分页、Realtime 与断线补拉、旧学期归档；课程会话改为学生首次加入时才创建（见 [ADR-0007](adr/0007-lazy-course-conversation-creation.md)） |
| 好友与私聊 | 好友申请、备注、隐藏、删除、双向拉黑；课程成员批量关系摘要、关系降级；私聊、未读、已读位置与个人历史清除 |
| 可靠发送 | 课程与私聊共用发送 RPC、客户端 UUID、幂等约束、失败保留与按失败类型重试、响应和 Realtime 去重 |
| 举报与清理 | 行为举报、不可变证据、举报消息保留；双方清除满 720 小时后的受控物理清理，默认 dry-run |
| 平台管理 | `/admin`、所有者与管理员、学校域名、课表导入、学期切换与审计；管理员跨校测试（课程、好友与私聊按当前学校判断，见 [ADR-0006](adr/0006-admin-cross-school-testing.md)） |
| 延迟显示 | 个人资料页「显示偏好」开关（只存本机浏览器，不进数据库）；开启后页面左下角显示两个毫秒读数：**网络**（HEAD 静态图标，不经函数与数据库）与**服务**（GET `/api/ping`，含 proxy 的登录校验与 Supabase 往返）。每 15 秒测一次，标签页在后台时暂停，换页立即重测；未登录时只显示网络读数 |

学习搭子、笔记共享尚未开发；举报证据已实现不代表内容审核后台已交付。

## 生产发布暂停与待办

- **生产数据库已搬到新 Supabase 项目（2026-09-25，us-west-2 → us-east-2）**：新项目 `CourseMate-east`（ref `xpmkpkplftgtfzecdwpd`）；旧项目 `CourseMate`（ref `cqrlxcxcgrcoamqnjkwu`）停写后原样保留，作为切换时刻的快照与回滚对照，观察几天确认稳定后再删，并把新项目改名回 `CourseMate`。步骤与踩坑见[迁移手册](runbooks/migrate-supabase-project.md)。
  - **数据核对**：`supabase db dump`（roles / schema / data）→ `psql --single-transaction` 导入。`auth` 与 `public` 共 30 张表的行数与旧库逐表一致（`auth.users` 7、`messages` 30、`course_catalog` 4988、`courses` 3924）；Realtime 发布仍只有 `messages`，RLS 策略 24 条，public 函数 69 个，均与旧库一致（下面补应用 `202609160001` 后为 70 个）。Storage 与 Edge Functions 本来为空，未迁移。
  - **授权被新库默认值重置，已修复**：导入后 `anon` 能执行几乎全部 public 函数（dump 的 `REVOKE ... FROM PUBLIC` 清不掉新库对 `anon`/`authenticated` 的单独授权）。已按 `schema.sql` 里的授权记录清空后逐项重放，并把 `postgres` 在 `public` 的函数与表默认授权改回旧库状态。复查：`anon` 只剩 `enabled_school_id_for_email_domain`，`authenticated` 可执行函数 47 个（补应用 `202609160001` 后为 48 个），表、列、序列权限与 dump 记录一致；`messages` 只有 `authenticated` 的 `select`。
  - **Auth 后台项在新项目重配**：Before User Created Hook、自定义 SMTP、邮件模板、OTP 参数、URL 配置不随 dump 迁移。Hook 已用 `attacker@gmail.com`、`x@sub.wisc.edu`、`x@wisc.edu.evil.com` 实测，均返回 403；学校域名与 `schools.enabled` 随数据迁移（`wisc.edu`、`umich.edu`、`msu.edu` 均已启用）。所有用户因 JWT 密钥变化需重新登录一次。
  - **前端已切换**：Vercel Production 与 Preview 的 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（Config 类型，publishable key）已换成新项目，Development 环境没有这两个变量；切换当时的生产 deployment 是 `dpl_J3VaZyb1VTobwhb2k6VTsPMywmET`（2026-09-25 01:24 UTC 在 Vercel 后台对生产部署执行 Redeploy 并取消构建缓存得到，没有发布新代码）。其后依次为 `dpl_4zBCQuuUcoVjibpBHoLHzrFVAVRo`（02:08 UTC，Promote 了 `feature/latency-indicator` 的预览，Vercel 用生产环境变量按 `e82efff` 重新构建，含延迟显示，但不含 `cle1`）和**当前生产 `dpl_7ENR16XM2RDTo7TQfuS9MLFrpQ4n`（02:20 UTC，在合并后的 `main` `5edd148` 上执行 `npx vercel deploy --prod`）**；后两次都是前端改动，数据库不变。切换后登录收验证码、课程列表、发消息、加入课程、Realtime 冒烟通过，新项目日志确认这些请求（`/auth/v1/verify`、`send_conversation_message`、`/realtime/v1/websocket` 等）落在新库，聊天历史保留。回滚：把 Production 变量改回旧项目并重新部署；切换后新库里的写入不会回到旧库。
  - **迁移历史表**：dump 不含 `supabase_migrations`，新库已用 `supabase migration repair` 登记仓库里全部 23 条迁移，`supabase db push --dry-run` 显示 "Remote database is up to date"。旧项目那条 `20260915051655` 记账行未带过来，是有意的。
  - **`vercel.json` 增加 `regions: ["cle1"]`**（Cleveland，贴近 us-east-2）；此前草稿里的 `pdx1` 对应旧区域，且缺逗号导致 JSON 不合法。`git.deploymentEnabled.main = false` 保持不变，合并到 `main` 不会自动上线。已随 `dpl_7ENR16XM2RDTo7TQfuS9MLFrpQ4n` 生效：线上 `x-vercel-id` 由 `cle1::iad1` 变为 `cle1::cle1`；同一部署对 `/login` 的服务端请求已在新项目日志里看到，读的是新库。注意：对预览部署点 Promote 是重新构建，构建自那个预览的提交，**不含 `main` 上之后才合并的改动**（这次的 `cle1` 就因此漏了一轮），要发 `main` 的当前状态用 `npx vercel deploy --prod`。
  - **仍待处理**：① 搬迁使用的两个数据库密码曾出现在会话记录里，需重置；② 旧项目的保留与删除时点；③ 旧库沿用至今的表级授权偏宽：`anon` 与 `authenticated` 对 `member_accounts`、`schools`、`school_email_domains` 有表级全部权限（含 `truncate`、`trigger`），实际写入被 RLS 挡住（三张表只有 `select` 策略），已原样迁移，尚未收紧，需先确认前端只读这三张表再用迁移收窄；④ 生产仍没有平台备份（新项目同为免费版），搬迁用的 dump 已按手册删除，含用户数据。
- **成员会话合并读取（迁移 `202609250001` 已在新项目应用，前端尚未发布）**：新增 `public.get_member_context(candidate_domain text)`（`security invoker`，只授予 `authenticated`），把绑定学校、邮箱域名对应的开放学校、当前学校与 onboarding 状态一次取回。动机来自 2026-09-25 的实测：延迟显示里「服务」读数稳定约 255ms、偶发 300–1200ms；函数本身只多约 12ms，Supabase 侧每次处理中位数约 29ms，开销主要是每个请求里串行的 Supabase 往返：proxy 3 次（`auth.getUser`、`member_accounts`、开放学校 RPC），页面渲染的 `getCurrentMember()` 再串行 5 轮（其中 `auth.getUser` 重复了一次）。合并后 proxy 与页面各 2 次（`auth.getUser` + 1 次 RPC）；大厅首页的平台身份、学校名、课程、私聊未读四路互不依赖，改为同时发出。语义不变：仍要求 Auth 用户存在、成员账号绑定一致、邮箱域名对应同一所开放学校，任何出错都按未登录处理（fail closed）。另发现 `cle1` 上线后，proxy 里的 Supabase 调用仍有约 87% 来自 us-east-1（用日志里的调用方 IP 对照 AWS 地址段得出，推断 proxy 在边缘节点而非 `regions` 指定的函数区域运行），所以减少调用次数比换区域更有效。**发布顺序：必须先在生产应用迁移，再发布前端。** 新前端的 proxy 依赖这个函数，函数不存在时所有请求都会按未登录处理（全员被踢回登录页）；旧前端不调用它，迁移可以先行。**2026-09-25 状态**：函数已在新项目建好，属性核对无误（`security invoker`、`stable`、`search_path` 为空，`anon` 与 PUBLIC 不可执行，只有 `authenticated` 可执行），并在真实数据上逐成员对照：7 个成员的结果与原来四次独立查询完全一致，没有登录身份时返回 0 行；`src/types/database.ts` 已从新项目重新生成；**迁移历史表还没登记这一条**（新项目里仍是 23 条，需运行 `supabase migration repair --status applied 202609250001` 或在 SQL Editor 补一行）。发布后用延迟显示的「服务」读数和新项目日志里每个请求的 Supabase 调用次数对比效果。
- **Issue #29 的迁移曾漏应用，2026-09-25 已在新项目补上**：`202609160001_course_member_relationships.sql` 新增受限批量关系摘要，并修正 active 好友在拉黑状态下的身份优先级；前端课程成员、邮箱搜索与私聊失败展示已接入。2026-09-20 本地验证通过：74 个测试文件、457 项测试及构建、lint、类型检查。发布必须先应用 migration，再发布依赖该 RPC 的前端，并从目标 Supabase 重新生成 `src/types/database.ts`。**2026-09-25 核实**：线上前端已经在调用该 RPC，数据库却一直没有这条迁移（旧库 dump 里没有该函数），课程页成员关系请求返回 404；搬库当天在新项目补应用，两个函数均为 `SECURITY DEFINER`、`search_path` 为空、`anon` 无执行权，之后课程页请求恢复 200。`src/types/database.ts` 已在 2026-09-25 随成员会话合并读取的改动从新项目重新生成，补上了此前缺少的 `list_course_member_relationships`。
- **Issue #30 与 #29 共用功能分支和后续 PR**：私聊请求 15 秒未返回时从“发送中”降级为可重试失败；重试沿用原 `clientMessageId`，迟到成功优先并忽略重复回执。上述完整验证同时覆盖 Issue #30；尚未发布。

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
