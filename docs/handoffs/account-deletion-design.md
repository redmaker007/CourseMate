# 永久注销：数据清单与实施边界（Ticket 6）

日期：2026-10-26；工作树 `tmp/app-readiness`，分支 `feature/mobile-auth-api`，起点 `fe4b72cd37f4ba9cbefc16aa997b889a6227b7fe`。这是开工设计与核查记录；本票现已形成独立的 [实际接口交接](mobile-account-deletion-api.md)，当前状态见 [STATUS](../STATUS.md)。

## 已确认和待确认

- 用户回复“开始”，按当前推理设置继续；无法读取或自动切换实际运行参数。
- ~~已选举报处理 A：永久注销时，默认清除相关正文和身份。~~ 2026-10-27 主开发者改为**匿名保留**：去掉本人 ID 和资料快照，举报原因、说明与证据正文保留。原因：默认清除会让被举报人靠注销抹掉别人对他的举报。实际规则见 [注销接口交接](mobile-account-deletion-api.md)。没有编造法定期限。
- 执行方式已选 A：本人核验／确认后一次数据库事务完成，失败整体回滚，凭不含身份的随机回执查询结果／重试；未选择后台任务分步方式。
- 只实施本票的本人核验、确认、受控删除、失败恢复和前端缓存契约；不自动实施 Ticket 7 或部署／生产删除。前端负责人实现原生页面和本机数据库配合。

## 实际核查方法和限制

在本机 PGlite 空库中执行仓库全部 28 条 SQL 迁移，查询最终系统目录的外键、表字段和触发器，再按源码核对。没有连接或读取远端用户数据；这个目录核查不是功能测试，也不代表 Supabase 托管 Auth／Storage 的真实删除链已验收。

结合 [举报交接](mobile-reporting-api.md)、[消息恢复](mobile-messages-api.md)、[私聊清理](direct-message-cleanup.md)、[会话 ADR](../adr/0009-verify-access-token-locally.md) 和 [管理员 ADR](../adr/0005-platform-roles-and-admin-functions.md) 判断影响。

## 数据清单

| 数据／副本 | 最终现有行为 | 本票必须处理／验证 |
|---|---|---|
| auth.users、Auth 身份／会话 | public.member_accounts 引用 auth.users 并级联；托管 Auth 内部表未由仓库迁移定义 | 核验本人；删除 Auth 账号及相应身份／刷新能力；验证内部级联和错误回滚，不只删除 public 行 |
| member_accounts、profiles | 成员、学校绑定和资料随账号级联；资料含昵称、头像 URL、专业及毕业年份 | 删除本人资料／绑定，旧 JWT 仍须被实时成员校验拒绝；同邮箱重新注册是新身份，不恢复旧缓存 |
| course_members、conversation_members | 本人的课程／会话成员关系级联删除，连带本人已读与个人清除状态 | 保留课程和共享会话及其他成员关系；不触发把整间课程或私聊删掉的清理 |
| courses.created_by | 删除成员只将创建者置空 | 共享课程与目录保留，不以注销删除其他人正在使用的课程 |
| messages | sender_id 为 SET NULL；原正文、client_message_id、source_friend_request_id 不会随之全部清空 | 删除本人正文及身份关联，保留稳定 ID 的必要非识别占位；他人原始消息正文不变。不能只置空 sender_id |
| direct_conversations | 删除一方会将 member_low／member_high 对应端置空 | 保留剩余参与者历史和会话；重新注册不能重占旧配对 |
| friendships、friend_preferences、member_blocks | 关联本人关系、双方在该关系上的偏好及拉黑随成员级联 | 两端关系缓存重新校验，避免旧好友入口或发送资格复活；不删除对方账号 |
| friend_requests、friend_request_active_pairs | requester／recipient 为 SET NULL，但 pair_low／pair_high 无成员外键，仍保留 UUID；申请附言仍在 | 处理涉及本人的申请、配对与原文副本；接受申请产生的他人消息仍保留，source_friend_request_id 可断开，不能残留本人 UUID |
| friend_rate_limit_buckets | actor_id 随成员级联 | 本人的计数桶随之删除；全局阈值配置不改 |
| behavior_reports | reporter_id 是无账号外键的非空 UUID，说明和多态 target_id 不自动清理 | 按已选 A 识别本人作为举报人／被举报人及本人来源内容的关联；清除应删身份和原文，不能仅清一个列而留下多态目标 |
| report_evidence | reported_user_id 无账号外键，snapshot 复制消息／申请／资料；UPDATE／DELETE 被触发器拒绝 | 为受控注销明确例外和权限；默认清理相关正文／身份，未确认依据的案件不能自动长期留存；避免正文从快照恢复 |
| report_source_retention | 不可变触发器；生成列 message_id 对 messages.id 为 ON DELETE RESTRICT；report_id 为限制删除外键 | 核对顺序与事务回滚，避免残留保留关系或全局放开普通成员的证据写权限；不能把 720 小时私聊清理期当举报期限 |
| direct_message_clear_ranges、cleanup_eligibility | 本人清除范围随会话成员级联；候选资格依赖消息和双方清除范围 | 普通清除与注销分开；验证既有预览／执行不会误删他人消息或跳过删除后的正文清理 |
| direct_message_cleanup_runs | 操作审计包含候选／已删消息 ID、状态与错误，没有账号级联 | 核查可识别关联和错误文案；最小非内容运行元信息不应成为恢复正文或身份的来源 |
| push_subscriptions | user_id 随成员级联，包含 endpoint 与密钥 | 删除本人全部网页订阅；投递前重新授权；已经投递的系统通知和离线设备不能即时远程消除 |
| push_dispatches | event_key 可能引用消息／申请 ID，没有账号外键 | 核查相关事件键与历史占位／重试语义，不能借重放旧意图恢复本人正文；与 Ticket 7 原生 token 联合验证 |
| platform_roles、admin_school_test_context | 本人管理身份／测试学校上下文级联；其他角色 granted_by 对账号 SET NULL | 现有唯一 owner 保护不可忽略；需在实施前明确注销与所有权转交边界，不能静默使平台无人管理 |
| admin_audit_log | actor_id SET NULL；target、details JSON 不自动清理。staff.grant_admin 将邮箱写入 details，target 为成员 UUID | 定向清理本人邮箱／身份引用，保留不含本人身份和正文的必要操作元信息；不扩大管理员权限或删除其他人的独立业务记录 |
| 本机课程／好友／聊天、草稿、失败发送、举报回执、导航状态 | 仓库没有原生 App 本机库实现 | 本人确认后锁定，成功后清本人缓存／凭据／设备关联；其他账号隔离；其他客户端恢复联网校验并删除不可见正文，不从旧响应／草稿复活 |
| Storage 对象、外部头像、备份／导出、平台日志 | 当前源码未发现 Supabase Storage 上传链；只有 avatar_url 字段。没有据此核实远端实际对象、备份或外部服务留存 | 部署前查明真实使用情况；有托管对象时纳入受控清理。不能把删除 URL 当删除外部文件，也不能承诺收回独立截图／导出 |

## 权限和失败边界

本人和目标只能从已验证身份推导，不能接受 App 指定任意 userId 或邮箱。永久删除需要明确确认及额外本人核验，不能复用“退出”或“个人清除”按钮的请求；只凭客户端显示确认弹窗不能代替服务端校验。

普通 authenticated／anon 不应取得 Auth 管理、证据任意修改或其他账号删除权限；需要管理凭据的实现仅在 server-only 内使用，不依赖 VAPID 是否配置，也不能将管理密钥传入 App。现有推送 serverEnv 的管理凭据限定说明需要在对应受控用途改变时核对。

网络中断不等于事务失败。执行方式无论选 A 还是 B，都必须有不泄漏身份的结果回执和重复请求规则；不能在用户已删除后仅靠原登录会话查询最终结果。失败时不能假报完成或只留下部分删除，重试不能操作同邮箱后来新注册的账号。

删除 Auth 用户后旧访问 JWT 并不因此自动过期。现有每请求的 get_member_context 能在成员绑定消失后拒绝原账号，但需验证所有新增删除／恢复入口及 RPC 不绕过它；不能把本地签名有效当作删除后的业务授权仍有效。

## 消息与缓存恢复

消息使用稳定 bigint ID；删除正文后的占位不能含原发送者、clientMessageId 或可回连本人身份的申请引用。普通读取与 reconcile 应移除客户端旧正文。分页、补拉、通知跳转、发送失败项与其他本机副本都不得把它恢复。

当前账号注销成功后清本人缓存，区别于普通退出“保留但锁定”。其他设备离线期间无法即时得知删除，重新联网验证后锁定／清理；成员失效的通用响应不必泄露其他账号是否已注销。已明确执行本人注销的客户端根据完成回执清理，不因暂时网络错误把它当已完成。

## 测试清单与验收边界

下列后端默认路径已完成本地 HTTP 合约和 SQL 权限／删除链测试；托管 Auth、外部数据、真实并发和原生缓存等项目仍待真实联调，逐项结果见 STATUS／实际接口交接，不将此清单整体视为已验收。

1. 伪造目标、未登录、资料未完成／学校停用、过期和复用确认、不同账号的凭据混用均不能删除他人。
2. 普通成员的课程／私聊正文、资料、申请／配对、关系、订阅及举报副本按选定规则清理；其他人的消息、课程和会话可用；必要占位没有原身份和正文。
3. 相关举报的两种方向、软删／个人清除／既有清理、非空外键及不可变触发器覆盖；数据库失败注入完整回滚。
4. 同时或重复请求、网络断开后查询、Auth 删除失败、原令牌／刷新令牌和同邮箱重新注册均不导致重复或错删。
5. 旧页面、历史分页、补拉、reconcile、通知和本地失败发送不恢复已删除正文；缓存锁定／清理的原生联合测试单独记状态。
6. 部署前核对托管 Auth 内部表、Storage、真实多连接并发、服务端超时与备份／日志处理；本地 PGlite 的 auth.users 简化定义不能替代托管验收。

## 官方依据与未定事项

[Apple 账号删除说明](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)要求处理关联账号数据和内容，并区分需依法保留的信息；它不替本项目确定哪份举报有保留依据或应保留多久。用户所选 A 是产品处理原则，不是对具体案件法律依据的认定。

[Supabase 用户管理](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)说明 Auth 删除、访问令牌残留和 Storage 归属限制；[deleteUser API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)说明管理删除只应在服务器使用。本票最终采用受控数据库内事务删除 Auth 主记录，避免跨 HTTP 部分完成；回执和本人核验实际契约见接口交接。托管版本、Storage 对象、外部日志／备份及合法保留例外仍需部署前核实，不能据本地测试声称全部清理。
