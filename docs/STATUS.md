# 当前状态

## 2026-10-26：阶段 3 后端代码审查及修复复查完成

Ticket 6 永久注销和 Ticket 7 iOS APNs 推送已完成本地实现、交接及独立 Standards／Spec 两轴审查。阶段基线 `fe4b72c` → 初审 `f0fa83b`，28 路径快照／指纹核对。Standards 发现同绑定登记会无条件清掉 pending／retry 通知的 P2；`cba0ee4` 修复为仅账号／会话／token／环境实际改变才清旧任务，同绑定重试保留队列。两轴分别针对性复查通过，无新增确认问题。

最终本次 `npm test` 110 文件／806 项 → build → lint → typecheck 依次通过；生产构建 HTTP 边界 10 项此前已复查通过。完整两轴报告、来源与指纹位置见 [阶段 3 审查记录](handoffs/mobile-stage-three-review-20261026.md)。详细原生通知、注册／解绑、导航和调度交接见 [推送交接](handoffs/mobile-push-api.md)。以下“待阶段 review”均为当时记录，以本节为最新。

仍待真实 Apple／APNs／iPhone、托管 Auth／SMTP／Storage、多连接竞态、网页／原生缓存与通知清理、合法保留例外、恢复 cron 配置、目标迁移及类型重新生成。后端代码符合性通过不等于联合验收或上架通过；无真实推送、远程迁移／删除、购买、push／合并／部署。Ticket 1 延期项继续保留，Ticket 8–10 未实施，不自动跨入下一阶段。

## 2026-10-26：iOS 私信推送 Ticket 7 本地实现，待阶段 review

用户选择 A：直接调用 Apple APNs，沿用阶段 3 当前推理设置。阶段基线 `fe4b72c`，本票起点 `3da1bbe`，在隔离工作树 `tmp/app-readiness` 的 `feature/mobile-auth-api` 实施，起点 clean；原根工作区其他功能改动未纳入。新增第 30 条迁移 `202610260002_mobile_push.sql`：受控设备绑定、消息事务队列、资格复查、租约／退避／失效处理及注销级联；与网页 VAPID 记录分开，不改变聊天写权限。

移动设备 PUT／DELETE、退出先解绑再撤销、APNs HTTP/2＋ES256、固定发送者＋“发来一条消息”提示及独立秘密保护的恢复入口已接线，无新增依赖。前端页面、注册／接收／冷启动／账号切换和运维调度要求见 [原生推送交接](handoffs/mobile-push-api.md)。未手写 database.ts，目标迁移后仍须 CLI 重新生成。

本次 `npm test` 110 文件／805 项通过 → build → lint → typecheck 通过；首次 build 发现环境字面量类型推导问题，修正后通过。数据库验证完整 30 条迁移和注销级联；发送器为真实本地 HTTP/2／临时 P-256 签名验证，HTTP 为真实 Supabase SDK 模拟网络。本地生产构建另验证 HTTP 边界 10 项；发现并修正 Next 空 POST 流被误报 400，定向回归与重新构建／lint／typecheck 通过，真实 HTTP 复查通过。单票轻量检查不代表阶段 3 审查或真机验收通过。

未提供／使用真实 Apple 凭据，未向 APNs 发真实通知、应用远程迁移、购买服务、配置线上恢复 cron 或 push／合并／部署。托管 Auth／PostgreSQL 并发、真机通知／缓存／退出／注销联调及调度启用待办；APNs 接受不等于到达，在途通知无法保证撤回，离线不可达设备可能无提示。Ticket 1 延期不变，Ticket 8–10 未实施。下方历史“Ticket 7 未实施”以本节为准；接下来仅做阶段 3 双轴 review。

## 2026-10-26：永久注销 Ticket 6 已实现，待阶段 review

基于 `fe4b72c` 在隔离工作树 `tmp/app-readiness`、分支 `feature/mobile-auth-api` 实施阶段 3 的 Ticket 6；起点 clean，用户回复“开始”后按当前设置继续。用户两项选择均为 A：默认清理相关举报正文／身份，明确保留例外另定；一次事务删除，失败整体回滚并支持回执查询／重试。[数据清单](handoffs/account-deletion-design.md)先基于原 28 条迁移核查；现新增第 29 条迁移 `202610260001_permanent_account_deletion.sql`，不手改生成的数据库类型，新 RPC 目前使用模块内窄调用端口，目标迁移后仍须 CLI 重新生成类型。

新增本人邮箱验证码核验、明确确认、原子注销及随机回执查询 HTTP 入口；独立于普通学校／资料准入。受控事务清理本人正文／身份、申请配对、相关举报三表及明确审计身份字段，级联资料／关系／订阅与 Auth 身份／会话；保留其他人的原消息、课程与必要非识别占位。普通证据权限仍关闭；owner 未转交或有未清 Storage 对象时明确拒绝，无数据已删。前端必须先保存回执，未知结果先查询，完成后清本人缓存／凭据；详见 [注销接口交接](handoffs/mobile-account-deletion-api.md)。

本次实际检查：注销 HTTP 7 项与完整迁移链 SQL 6 项定向通过；SQL／举报／清理 4 文件／25 项回归通过（此前 SQL 为 5 项）。最终 `npm test` 107 文件／781 项 → build → lint → typecheck 依次通过。本地生产 HTTP 边界 9 项通过，覆盖认证、Cookie 冒充、错误授权、回执格式、JSON 405／Allow 与 404，均 no-store、不设置 Cookie，无真实发码或删除。轻量自检未发现新增阻塞。

未执行远程迁移、真实账号删除、托管 Auth／SMTP／Storage、多连接竞态、iOS 或网页已打开内存缓存联合验收；也未 push、合并或部署。合法保留例外、外部日志／备份与运营导出范围仍须负责人核实，本版默认清理不可直接用于已有明确保留要求的案件。Ticket 1 延期项保留；Ticket 7 未实施，阶段 3 整体双轴 review 待两票完成，不自动开工其他票。

## 2026-10-25：移动 API 阶段 2 后端实现及双轴代码审查完成

阶段 2 的 Tickets 2–5（课程、好友、消息、举报）已完成本地后端实现与详细前端交接；不是原生客户端或完整联合验收完成。基线 `bd1d557` → 初审 `67d22bd`，24 个阶段文件及必要调用者由两个独立 reviewer 分别审查 Standards 和 Spec。两轴各发现同一项 P2：大写会话 UUID 可成功发送却因回执字符串比较误报 503，clientMessageId 大小写也可能妨碍 pending 匹配。

修复提交 `a0da6294d82fd4c424144c5a6f43b7ac29278af8`：移动消息入口校验后统一两种 UUID 为小写；保留身份／目标验证与当前 RLS 可见性检查。先新增失败回归再修复，3 文件／34 项定向通过；两轴均完成指纹核对和针对性复查，原 P2 解决，无其他新增阻塞。最终 `npm test` 105 文件／768 项通过 → build → lint → typecheck 依次通过。版本、两轴报告、快照／指纹与未验收边界见 [阶段审查记录](handoffs/mobile-stage-two-review-20261025.md)。以下各票“待阶段 review”为当时记录，以本节为最新结论。

仍待真实账号、iOS 页面／本机缓存、托管 PostgreSQL 多连接竞态、推送实际投递与运营处置验收；课程消息举报、过滤、审核响应／公开联系渠道、跨目标限流及证据保留政策的发布缺口见 [举报交接](handoffs/mobile-reporting-api.md)。Ticket 1 延期及首次验码失败分类遗留继续保留；永久注销／证据清理和原生推送分别属于 Ticket 6／7。未 push、合并、部署或写远程业务数据；阶段边界交接，不自动进入 Ticket 6。

## 2026-10-25：移动举报 Ticket 5 已实现，待阶段 review

基于 `344f328` 在 `feature/mobile-auth-api` 的隔离工作树新增 `POST /api/mobile/v1/reports`，复用既有举报服务、目标权限与受控 RPC。只接受目标类型／ID、原因和说明；身份来自 Bearer，证据与被举报人由数据库推导。UUID 归一、bigint 字符串精度、pending 重试、畸形响应和私密错误均有检查；不新增迁移、依赖、审核权限、处罚或限流政策。详见 [移动举报交接](handoffs/mobile-reporting-api.md)。

本次实际检查：移动举报 24 项；移动／举报服务回归 4 文件／31 项；完整迁移链、举报与私聊清理 4 文件／44 项通过。最终 `npm test` 105 文件／767 项 → build → lint → typecheck 依次通过；生产构建本地 HTTP 边界 7 项通过，覆盖认证、Cookie 冒充、错误授权、JSON 405／Allow 和 404，均 no-store 且不设置 Cookie。SQL 实际验证目标可见性、本人身份、被举报者不可读、证据／留存链、清除后拒绝，以及课程消息举报尚不支持。轻量检查未发现新增阻塞，待执行阶段 2 的双轴 review。

发布缺口已逐项记录：课程消息举报、内容过滤、审核处置与响应负责人、公开联系渠道、跨目标限流，以及证据保留依据／期限。现有三表受控落库及可定位不等于已有审核工作台；举报不自动拉黑／处罚；证据不可变触发器与消息留存外键对 Ticket 6 的永久注销有实际约束，未擅自删除或无限保留。本票不表示 App Store 条件已满足。

未提交远程真实举报、修改处置或关系数据，未验证真实账号、运营处理、PostgreSQL 多连接竞态及 iOS；未 push、合并或部署。Ticket 1 延期项保留。Ticket 5 是阶段 2 最后一票，后续只做本阶段审查，不自动进入 Ticket 6。下方历史票据的“Ticket 5 未开始”以本节最新状态为准。

## 2026-10-25：移动聊天 Ticket 4 已实现，待阶段 review

基于 `67f3d6e`，在 `feature/mobile-auth-api` 的隔离工作树实施同属阶段 2 的 Ticket 4。新增课程／私聊会话列表与状态、精确字符串消息 ID 的历史分页／有界补拉、受控幂等发送、本人私聊已读／清除及缓存 ID 重新校验。复用既有 RLS 与 RPC，无新增迁移、依赖或 messages 直接写权限；确认的私信发送沿用已有网页推送调度，实际推送未验收。

清除后重试原发送 UUID 时，再经过当前 RLS 校验回执；不可见则只确认请求已处理，不回传旧正文。恢复协议要求重新核验已缓存 ID、覆盖区间重扫、按 ID 合并和淘汰过期响应，防止旧正文恢复或迟提交消息遗漏。接口、字段、原生页面与失败处理详见 [移动聊天交接](handoffs/mobile-messages-api.md)。永久注销最终删除／占位及物理删除后 UUID 重放边界由 Ticket 6 联合验证，不能将本票视为注销已实现。

本次实际检查：移动聊天定向 23 项及完整迁移链 SQL 7 项通过；最终 `npm test` 104 文件／742 项通过 → build → lint → typecheck 依次通过。本地生产构建 HTTP 边界 10 项通过，覆盖 8 个消息入口认证、Cookie 不能冒充 Bearer、JSON 405／404，均 no-store 且不设置 Cookie。SQL 验证实际 RLS、幂等／冲突、个人清除、拉黑、删除可见性和退课收权；轻量检查未发现阻塞。

未写远程业务数据，未验证真实账号／设备、推送投递和 PostgreSQL 多连接竞态；未 push、合并或部署。Ticket 1 延期项继续保留；阶段 2 的 Ticket 5 与整阶段双轴 review 待办，原生 UI／本机缓存验收未完成。下方各票记录保留其当时状态，以本节及 Notion 最新记录为准。

## 2026-10-25：移动好友 Ticket 3 已实现，待阶段 review

基于 `7334c01`，继续在 `feature/mobile-auth-api` 的隔离工作树实施同属阶段 2 的 Ticket 3。新增好友／屏蔽专门列表、本人好友详情、精确邮箱 POST 发现、申请与响应、本人拉黑列表、备注／屏蔽／拉黑／删除移动入口；复用既有 service／RPC，无新增依赖或迁移，不改好友网页、学校授权、历史保留或消息投递语义。只有服务端确认 sent 才沿用既有网页申请推送调度；不新增原生好友申请通知。

当前学校、新申请同校限制、跨校已有历史与自我保护例外继续由 RPC 授权。找人邮箱不进入 URL 或响应；操作结果区分冲突、限流、禁止与成功，未知／畸形成功结果不报成功。分页与 Ticket 2 共用原有规则。前端逐页要求、字段、按钮、跨校／拉黑限制和缓存契约见 [移动好友交接](handoffs/mobile-friends-api.md)。好友列表 sendStatus 不代表消息发送的完整资格，需由后续消息接口重新确认。

本次实际检查：移动好友定向 23 项；好友／网站／SQL 跨校与关系回归 6 文件／82 项通过；最终 `npm test` 103 文件／718 项通过 → build → lint → typecheck 依次通过。本地生产构建真实 HTTP 边界 14 项通过，验证全部好友入口认证、Cookie 不能冒充登录、找人只接受 POST、JSON 405／404、no-store 与不设置 Cookie。轻量检查未发现阻塞。

未发送真实申请或修改远程关系数据，未验证真实账号／设备、网页推送投递与 PostgreSQL 多连接竞态；未 push、合并或部署。Ticket 1 延期测试继续保留；阶段 2 的 4–5 未实施，整阶段双轴 review 尚未启动。原生 UI 和消息读写不在本票交付。

## 2026-10-25：移动课程 Ticket 2 已实现，待阶段 review

基于 `bd1d557` 在隔离工作树 `tmp/app-readiness`、分支 `feature/mobile-auth-api` 实施；用户明确将 Ticket 1 剩余测试延期。新增移动课程本人列表、当前学期搜索、详情、加入／退出和受权会话入口。学校与用户取自 Bearer 成员上下文，资料未完善返回 403；移动入口明确拒绝跨校和旧学期写操作。分页和退出后缓存／权限恢复契约见 [移动课程交接](handoffs/mobile-courses-api.md)。原生页面及消息读写未计入本票。

搜索和加退课的 Supabase 适配器从网页工厂抽出供两端复用；既有匹配排序、写入失败语义、RLS 与会话惰性创建保留，无新增依赖或迁移。本次实际检查：移动课程定向 22 项通过；完整 `npm test` 102 文件／695 项通过 → build → lint → typecheck 依次通过。实际本地生产构建 HTTP 检查 7 项通过，覆盖五个课程入口认证、Cookie 不能冒充 Bearer、错误方法 JSON 405 及未实现路径 JSON 404；无 Cookie 写入，均 no-store。

本票轻量检查未发现阻塞；阶段 2 的 Tickets 3–5 尚未实施，整阶段双轴 review 未启动。未 push、合并、部署或写远程业务数据；真实账号课程联调、多连接 PostgreSQL 竞态与 iOS／缓存验收未做。Ticket 1 原有剩余项继续保留，不因本票实施而标为通过。

## 2026-10-25：CourseMate-test 环境配置与初步联调

用户指定 `CourseMate-test`（`cqrlxcxcgrcoamqnjkwu`，us-west-2）为测试环境；生产 `CourseMate-main` 未修改。测试库补齐 6 条仓库迁移并登记历史，Auth 用户、成员、资料均仍为 7 条；成员上下文 RPC 禁止 anon、允许 authenticated。访问令牌有效期由 3600 调整为 900 秒，保留 6 位／600 秒 OTP、自定义 SMTP、准入 Hook 和 60 秒重发间隔。

隔离工作树已通过忽略的 `.env.local` 连接此测试库。本地移动接口读取 3 所学校成功，未登录、伪造 Bearer、Cookie 冒充、输入与请求边界已检查。实测发现格式错误的 refreshToken 被误归类为 503，已修复并复测为 401／session_invalid；新增定向回归通过，全量 101 文件／673 项测试、build、lint、typecheck 依次通过。

随后用户提供学校邮箱并在本地验证页输入验证码，11 项真实单会话检查全部通过：收信后验证码登录、成员／本人资料读取、空昵称校验、按原值保存及重读、正常刷新、刷新后读取成员、当前设备退出、退出后刷新被拒绝。资料内容未变，测试会话已退出。首次资料补全、双设备隔离、自然到期、成员失效及临时故障联调仍未验收。详见 [测试记录](handoffs/mobile-auth-test-20261025.md)。未发布移动接口或验证 iPhone 原生端。

## 2026-10-22：移动认证阶段 1（本地功能分支）

`feature/mobile-auth-api` 基于主线 `e4be133` 实施 Ticket 1，尚未合并或部署。新增 `/api/mobile/v1/` 学校、验证码、会话刷新、可信成员、本人资料与当前设备退出 HTTP 入口；复用既有账号、学校准入及资料规则，网页 Cookie／Server Actions 保留。无数据库迁移或新增依赖。

接口与原生前端接入要求见 [移动认证交接](handoffs/mobile-auth-api.md)。刷新后先保存整对新凭据，再查询成员状态；临时网络故障不等于账号失效。原生页面、安全凭据存储、本地缓存和推送不在本票实现范围。

本次本地检查：最终全量 `npm test` 101 文件、672 项通过；随后 `npm run build`、`npm run lint`、`npm run typecheck` 依次通过。生产构建的本地 HTTP 检查确认：未带 Bearer 的 session/profile 返回 JSON 401，未知移动路径 JSON 404、错误方法 JSON 405；没有 Cookie 登录或 HTML 重定向。移动接口及 Proxy 定向回归 21 项、审查新增的会话到期回归分别通过；具体最终结果记录在 Notion Ticket 1。

阶段代码审查：Standards 未发现实质问题；Spec 初审发现服务端 `session_expired` 被误归类为暂时故障，已修复并由独立 reviewer 定向复查通过。上述最终全量检查包含修复。代码符合性已审查，真实环境验收仍按下段保留；未 push、合并或部署。

尚未完成托管 Supabase 真实 OTP、刷新／多设备联调、真实配置核对或 iPhone 验证；本地 SDK 模拟网络测试不能替代这些验收。阶段 review 状态另行记录，不能将本节当作已完成上架准备。以下既有主线及生产记录保留原日期，不代表本分支已发布。

## 既有主线及生产记录

核对日期：2026-09-27（RLS 策略提速与外键索引上线）。代码基线：`main` 的 `7896191`（PR #42 合并后）；生产前端仍是 `64b0904`，#42 只改数据库，不需要重新发布前端。
本页区分代码基线与生产状态；生产状态以下方带日期的条目为准，其中 2026-09-25 的搬迁条目是当前生产数据库的起点。当时的操作、证据与待办清单见[发布交接](handoffs/release-20260925.md)。

## 代码已实现

| 模块 | 范围 |
|---|---|
| 认证与资料 | 学校精确邮箱域名、六位 OTP、成员绑定、会话与当前设备退出；首次登录强制补全资料；成员会话本地验签并由 `get_member_context` 一次读取成员账号（[ADR-0009](adr/0009-verify-access-token-locally.md)） |
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
  - **前端已切换**：Vercel Production 与 Preview 的 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（Config 类型，publishable key）已换成新项目，Development 环境没有这两个变量；切换当时的生产 deployment 是 `dpl_J3VaZyb1VTobwhb2k6VTsPMywmET`（2026-09-25 01:24 UTC 在 Vercel 后台对生产部署执行 Redeploy 并取消构建缓存得到，没有发布新代码）。其后依次为 `dpl_4zBCQuuUcoVjibpBHoLHzrFVAVRo`（02:08 UTC，Promote 了 `feature/latency-indicator` 的预览，Vercel 用生产环境变量按 `e82efff` 重新构建，含延迟显示，但不含 `cle1`）和 `dpl_7ENR16XM2RDTo7TQfuS9MLFrpQ4n`（02:20 UTC，在合并后的 `main` `5edd148` 上执行 `npx vercel deploy --prod`，带上了 `cle1`；之后又有新的生产部署，当前生产见下面「本地验签与课程、私聊页并行取数」）；后两次都是前端改动，数据库不变。切换后登录收验证码、课程列表、发消息、加入课程、Realtime 冒烟通过，新项目日志确认这些请求（`/auth/v1/verify`、`send_conversation_message`、`/realtime/v1/websocket` 等）落在新库，聊天历史保留。回滚：把 Production 变量改回旧项目并重新部署；切换后新库里的写入不会回到旧库。
  - **迁移历史表**：dump 不含 `supabase_migrations`，新库已用 `supabase migration repair` 登记仓库里全部 23 条迁移，`supabase db push --dry-run` 显示 "Remote database is up to date"。旧项目那条 `20260915051655` 记账行未带过来，是有意的。
  - **`vercel.json` 增加 `regions: ["cle1"]`**（Cleveland，贴近 us-east-2）；此前草稿里的 `pdx1` 对应旧区域，且缺逗号导致 JSON 不合法。`git.deploymentEnabled.main = false` 保持不变，合并到 `main` 不会自动上线。已随 `dpl_7ENR16XM2RDTo7TQfuS9MLFrpQ4n` 生效：线上 `x-vercel-id` 由 `cle1::iad1` 变为 `cle1::cle1`；同一部署对 `/login` 的服务端请求已在新项目日志里看到，读的是新库。注意：对预览部署点 Promote 是重新构建，构建自那个预览的提交，**不含 `main` 上之后才合并的改动**（这次的 `cle1` 就因此漏了一轮），要发 `main` 的当前状态用 `npx vercel deploy --prod`。
  - **仍待处理**：① 搬迁使用的两个数据库密码曾出现在会话记录里，需重置；② 旧项目的保留与删除时点；③ 旧库沿用至今的表级授权偏宽：`anon` 与 `authenticated` 对 `member_accounts`、`schools`、`school_email_domains` 有表级全部权限（含 `truncate`、`trigger`），实际写入被 RLS 挡住（三张表只有 `select` 策略），已原样迁移，尚未收紧，需先确认前端只读这三张表再用迁移收窄；④ 生产仍没有平台备份（新项目同为免费版），搬迁用的 dump 已按手册删除，含用户数据。
- **成员会话合并读取（迁移 `202609250001` 已在新项目应用并登记，前端已于 2026-09-25 发布）**：新增 `public.get_member_context(candidate_domain text)`（`security invoker`，只授予 `authenticated`），把绑定学校、邮箱域名对应的开放学校、当前学校与 onboarding 状态一次取回。动机来自 2026-09-25 的实测：延迟显示里「服务」读数稳定约 255ms、偶发 300–1200ms；函数本身只多约 12ms，Supabase 侧每次处理中位数约 29ms，开销主要是每个请求里串行的 Supabase 往返：proxy 3 次（`auth.getUser`、`member_accounts`、开放学校 RPC），页面渲染的 `getCurrentMember()` 再串行 5 轮（其中 `auth.getUser` 重复了一次）。合并后 proxy 与页面各 2 次（`auth.getUser` + 1 次 RPC）；大厅首页的平台身份、学校名、课程、私聊未读四路互不依赖，改为同时发出。语义不变：仍要求 Auth 用户存在、成员账号绑定一致、邮箱域名对应同一所开放学校，任何出错都按未登录处理（fail closed）。另发现 `cle1` 上线后，proxy 里的 Supabase 调用仍有约 87% 来自 us-east-1（用日志里的调用方 IP 对照 AWS 地址段得出，推断 proxy 在边缘节点而非 `regions` 指定的函数区域运行），所以减少调用次数比换区域更有效。**发布顺序：必须先在生产应用迁移，再发布前端。** 新前端的 proxy 依赖这个函数，函数不存在时所有请求都会按未登录处理（全员被踢回登录页）；旧前端不调用它，迁移可以先行。**2026-09-25 状态**：函数已在新项目建好，属性核对无误（`security invoker`、`stable`、`search_path` 为空，`anon` 与 PUBLIC 不可执行，只有 `authenticated` 可执行），并在真实数据上逐成员对照：7 个成员的结果与原来四次独立查询完全一致，没有登录身份时返回 0 行；`src/types/database.ts` 已从新项目重新生成；迁移历史已登记（新项目 24 条）。**前端发布**：03:37 UTC 先在后台对 `feature/faster-member-session`（`e4fd5dc`）的预览点 Promote，得到 `dpl_2q2psgmAqSLbi3WTeTtJdsYoiANh`；随后合并 PR #35，03:47 UTC（美东 23:46）在 `main` `5254715` 上 `npx vercel deploy --prod` 得到 `dpl_TZFBsJYmAibtT96YYg2tRFjLBbdD`，两次代码相同（此后又有新部署，见下一条）。**效果**：用户在线上实测「服务」读数由约 255ms（偶发 300–1200ms）降到平均约 170ms（最低 135、最高 400），与每次校验少一轮往返（每轮约 75–85ms）吻合；这是单人单机的读数，样本不大，而且只覆盖 proxy 这条路径，页面渲染那 5 轮变 2 轮的收益没有单独测量。新项目日志佐证新流程在按预期工作：部署后 `get_member_context` 与 `auth/v1/user` 各 161 次、全部 200，与旧的 `member_accounts` 单独查询已经消失，没有 4xx。**后续**：剩下那次 `auth.getUser()` 已在 PR #37 改成本地验签，见下一条。
- **本地验签与课程、私聊页并行取数已发布（2026-09-25）**：PR #38（课程页、私聊页互不依赖的查询并行：`resolveJoinedCourse` 4 轮 → 2 轮，`getCourseRoom` 校验后 5 步 → 2 步，私聊页 2 轮 → 1 轮）与 PR #37（`auth.getClaims()` 本地验签，不再调用 `/auth/v1/user`，见 [ADR-0009](adr/0009-verify-access-token-locally.md)）已合并，04:08 与 04:10 UTC 先后发布，**当前生产 `dpl_6s4D3ELqoP5bJ7ZgPi844BCG6acU`（`main` `64b0904`）**，上一版 `dpl_FUC5KoajAs9X3t9tHSMxYJ3oijVQ` 只含 #38，可作回滚目标。
  - **代价与缓解**：别处退出登录后，令牌最长还能用 15 分钟。已在 Supabase 后台把 Access token expiry time 从 3600 改为 900 秒，日志里重新登录后签发的令牌 `expires_at − issued_at` 为 900，设置已生效；后台删除用户仍立即生效（每次读成员账号）。新建或搬迁项目必须重设这个值，见[新建项目手册](runbooks/new-supabase-project.md)。
  - **私聊页行为变化**：会话没授权时，消息接口现在也会被同时调用一次；两个接口各自由数据库授权，页面只在两者都成功时才渲染，否则 404。
  - **效果（日志，单次抽样）**：课程页一次加载在 Supabase 侧的调用，从迁移当天旧代码的约 1.4s（几乎全串行）降到约 0.21s，且没有 `/auth/v1/user`；部署后 `get_member_context` 155 次全部 200、无 4xx（唯一一次 409 是资料保存"先 insert 再 update"的预期行为）；`jwks.json` 拉取 8 次（每个新函数实例首次一次）。#37 之后的「服务」读数没有记录。
  - **尚未做**：在 `get_member_context` 里检查令牌的 `session_id` 是否还在 `auth.sessions`，恢复"退出登录立即失效"（见 ADR-0009，加入封号或强制下线功能时应当做）；管理页 `requireStaff` 等其他串行取数。好友页本来就是并行，发课程消息不经过会话解析，都不需要改。详见[发布交接](handoffs/release-20260925.md)。
- **RLS 策略提速与外键索引已上生产（2026-09-27，PR #42，关闭 #40、#41）**：迁移 `202609260001_rls_initplan_and_fk_indexes.sql` 把 14 条策略里不随行变化的 `auth.uid()`、`has_completed_onboarding()`、`current_school_id()` 包成 `(select ...)`，每次查询只算一次；逐行函数 `is_course_member(course_id)`、`shares_course_with(id)` 不变。另外给 13 个外键补了索引。
  - **应用前**：本地在 PR 分支上跑 `npm test`（84 个文件、567 项）、build、lint、typecheck，全部通过；只读核对生产 14 条策略的原定义与仓库迁移一致，原定义已留作回滚依据。
  - **应用方式**：由 redmaker 在 Studio SQL Editor 手工执行。注意本地 `supabase/.temp/project-ref` 仍指向旧项目 `cqrlxcxcgrcoamqnjkwu`，`--linked` 的 CLI 命令会打到旧库，使用前先 `supabase link` 到新项目。
  - **应用后核对**：14 条策略在 `pg_policies` 中都已是 `( SELECT ... )` 形式，角色（`authenticated`）与命令不变，其余条件一字不差；13 个索引都在 `pg_indexes` 里。Performance Advisor 显示 `auth_rls_initplan` 11 → 0、`unindexed_foreign_keys` 13 → 0。Unused Index 从 5 条增加到 18 条，多出的正好是 13 个新索引（刚建还没被用过），按约定不删；两条 Multiple Permissive Policies 保留，另开任务讨论。
  - **仍待处理**：① 迁移历史表还没有登记 `202609260001`（手工执行不会自动记账），需补一行 `insert into supabase_migrations.schema_migrations (version, name) values ('202609260001', 'rls_initplan_and_fk_indexes');`；② 测试组冒烟：课程大厅、加入与退出课程、好友页、个人资料；③ 没有测量上线前后的延迟变化。
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
