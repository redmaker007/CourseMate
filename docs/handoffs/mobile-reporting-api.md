# 移动举报与安全处理交接（Ticket 5）

2026-10-26 补充：用户在 Ticket 6 选择默认清理相关举报正文／身份，并以一次事务执行。新迁移对受控注销设置最小例外，普通证据权限保持关闭；相关三表记录在默认清理范围内，无关举报保留。实际处理、合法保留例外尚未实现的边界及部署顺序见 [注销交接](mobile-account-deletion-api.md)。以下描述保留本票交付时状态。

日期：2026-10-25；实现起点 344f328，分支 feature/mobile-auth-api。当前进度见 [STATUS](../STATUS.md)。本文件描述实际后端契约及查到的发布缺口，不表示原生页面、运营处置、App Store 条件或永久注销已完成。

## 实际入口与权限

`POST /api/mobile/v1/reports`，要求 `Authorization: Bearer <accessToken>` 和 `Content-Type: application/json`；Cookie 不作为身份。请求体最多 16 KiB；响应 private/no-store，不设置 Cookie。GET 或其他方法返回 JSON 405，Allow=POST；不存在举报列表／管理员审核移动入口。

```json
{
  "targetType": "message",
  "targetId": "9007199254740993",
  "reason": "harassment",
  "details": "这条站内消息含有针对我的辱骂。"
}
```

| 字段 | 实际约束 |
|---|---|
| targetType | friend_request、message 或 profile，大小写严格匹配 |
| targetId | friend_request 的申请 UUID，profile 的成员 UUID；message 为十进制正 bigint 字符串，最大 9223372036854775807。禁止 JS number；UUID 转为小写再提交 |
| reason | harassment（骚扰）、spam（垃圾信息）、impersonation（冒充）、threat（威胁）、inappropriate（不当内容）、other（其他） |
| details | 可省略／null／字符串；去除首尾空白后最多 1000 个 Unicode 字符，空白转 null；other 必须填写非空说明 |

拒绝未知字段、查询参数或错误类型。不能提交 reporterId、reportedUserId、schoolId、snapshot、处罚结果或任意附件 URL；不支持上传截图作为本票证据。

数据流：统一移动入口验证 Bearer → 可信成员与 onboarding → 既有 reporting-service 校验 → 当前用户 Supabase 客户端调用 `create_behavior_report` → RPC 在同一事务中核对目标、推导被举报人、保存快照与留存 → 只返回 status、reportId。没有 service_role 访问、直接表写入或客户端自报证据。

## 可举报的实际范围

- friend_request：当前调用者收到的申请；申请发送者举报自己时返回 self_report。只能关联站内申请，不能用邮箱或对方 UUID 代替申请 ID。
- message：当前调用者仍可见的私聊消息，发送者非空、未软删除、未被本人清除；不能举报自己的消息。拉黑保留历史，因此不妨碍举报仍可见内容。删除好友后的访问资格仍按既有 RPC 判定。
- profile：RPC 按当前学校、共同课程、现有好友或申请历史等既有条件确认可关联的资料；不能举报自己。客户端不能假定任意成员 UUID 都可举报。
- **课程消息尚不支持**：现有 RPC 的 message 分支要求 `can_access_direct_conversation`，课程消息即使可读也返回 not_available。完整迁移链测试已确认，不能将它显示为已受理。本票不扩展共享 RPC；该缺口必须在课程聊天发布前单独讨论和补齐。

目标可见性由服务端重查；缓存里曾经有一条记录不代表现在仍有举报资格。已清除／已删除／无权访问的目标不提供证据替代入口，不能让客户端上传旧正文冒充数据库快照。线下纠纷不在受理范围。

## 反馈、重试与拉黑

新建返回 HTTP 201：

```json
{"status":"created","reportId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
```

同一举报人、同一类型、同一目标已有 pending 时返回 HTTP 200／already_pending 和原 reportId；**不更新原原因、说明或证据**。网络失败可用同一目标手动重试，不能显示为已受理。若重试前目标已清除或权限已变，仍可能返回 not_available，不承诺必然取回原回执。状态不再 pending 后不保证同一 ID，不提供离线自动举报队列。

| HTTP／status | 前端反馈及动作 |
|---|---|
| 201 created | “举报已提交，等待处理。举报不会自动拉黑或处罚对方。”保存最小回执 |
| 200 already_pending | “该内容已有待处理举报，已保留原举报。”不要承诺覆盖原说明 |
| 400 invalid_request／invalid_target | 修正字段或目标标识；不能替换成一个伪造目标 |
| 400 invalid_reason／invalid_details | 提示原因选项及说明长度，保留表单草稿 |
| 403 self_report | “不能举报自己的内容或资料。” |
| 403 onboarding_required | 转资料完善；membership_denied 按认证契约锁定／准入处理 |
| 401 authentication_required／access_token_invalid | 按认证契约刷新或重新登录；不误报举报已提交 |
| 404 not_available | “该内容不存在或当前无法举报。”本状态不能证明内容已删除，也不能抹掉整个账号缓存 |
| 503 temporarily_unavailable | 保留草稿并允许手动重试；不暴露 SQL、证据或内部异常 |

413／415 沿用统一请求体／JSON 边界。当前举报 RPC **没有按时间或数量限流**，只有“一目标一条 pending”去重；这不能防止多个目标刷举报。不返回虚构 429、倒计时或 Retry-After。入口认证、长度限制和去重不是完整反滥用策略；跨目标限流政策列为待讨论，不能仅在 App 按钮禁用后声称服务端已限流。

举报和拉黑是两个独立请求。拉黑沿用 [移动好友契约](mobile-friends-api.md) 的 `POST /friends/{memberId}/block` 和 `{"blocked":true}`；明确由用户选择，操作后重读真实状态。若提供“举报并拉黑”，必须分别显示两项结果和失败项，不能把一次成功当两次成功；举报不会撤销，拉黑失败不应重复创建举报。屏蔽是显示偏好，不代替拉黑或举报；不新增处罚或通知被举报者。

## 原生页面与本机数据要求

1. 从受支持的私聊消息、收到的申请或资料进入表单；保存正确类型与真实目标 ID，显示可理解的目标摘要。对课程消息不能给出虚假的可用入口，缺口未补齐前不能宣称完整课程安全能力。
2. 显示六种原因、other 必填说明、1000 字符限制，以及“不会自动拉黑／处罚”的说明。提交期间禁用重复点击；保留失败草稿，在线手动重试。无网时明确提示联网提交，不排队自动发送。
3. 成功只展示回执与待处理反馈，不承诺已处罚、处理时限或证据内容可查。返回导航和通知不能绕过当前账号状态。若展示联系入口，必须先取得实际公开且有人处理的渠道，不能使用占位邮箱。
4. 草稿和最小回执按账号隔离，遵循已确定的退出锁定与账号切换规则；不能将举报详情、证据或举报人 ID 放入 URL、推送或普通社交缓存。发送目标正文由已有聊天缓存协议管理，不能把举报草稿当作正文恢复来源。

## 后台定位与现有处置链

举报受理会原子写入三张现有表，reportId 可在受控数据库运维入口定位。普通成员仅能 SELECT 本人的 behavior_reports，不能读 report_evidence／report_source_retention 或更新审核状态；被举报者不能凭 reportId 读取举报人的记录。API 不把这些表的原始行返回给 App。

以下只读 SQL 供有既有数据库权限的负责人在受控运维环境定位**一个已知举报 ID**，替换虚构 ID 后执行；本票没有执行远程查询，也不授予新的角色权限。结果含受控内容，不复制到公开工单／普通日志／Notion 或被举报者界面。

```sql
select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
       e.reported_user_id, e.snapshot, e.captured_at,
       s.source_type, s.source_id, s.message_id::text
from public.behavior_reports r
join public.report_evidence e on e.report_id = r.id
join public.report_source_retention s on s.report_id = r.id
where r.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
```

仓库支持 pending／dismissed／actioned 状态存储，但未找到举报审核工作台、受限审核 RPC、分派／提醒、响应时限、申诉或给举报人的处理反馈链路。现有 `/admin` 只处理平台角色、学校、课程／学期、测试学校及其审计，不能据其存在宣称举报处理后台已完成。没有给 authenticated 或一般管理员角色扩大证据访问权；SQL Editor 的既有受控定位能力不等于日常审核产品。

## 发布要求核查与缺口（待讨论，不自动实施）

2026-10-25 核对 [Apple 审核指南 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)：用户生成内容服务需要不当内容过滤、举报和及时响应、拉黑能力以及公开联系信息。以下是代码／文档核查结果，未核实外部运营配置，不能据此保证审核通过。

| 项目 | 当前事实／证据 | 待落实及影响 |
|---|---|---|
| 内容过滤 | 消息做长度／空白校验，SafeMessageText 防 HTML 注入；未发现不当内容检测或阻止发布流程 | XSS 防护和学校准入不能等同内容过滤；需决定覆盖消息、申请附言与资料的治理方式，不自动实施智能审核 |
| 举报覆盖 | 私信／申请／资料经既有 RPC；课程消息不支持 | 课程内容覆盖是发布缺口，需界定共享 RPC／网页影响后实施 |
| 及时响应 | 三表原子落库，可用 reportId 受控定位；状态字段存在 | 缺实际负责人、工作台／受控操作、提醒及响应／升级安排；需运营确认时限，不编造 Apple 固定小时数 |
| 拉黑 | Ticket 3 及既有 RPC 支持单向拉黑、双方禁止新私信，历史保留 | 原生入口、与举报的独立结果仍需联调；课程群聊仍可见该成员内容，不能声称全站移除该用户 |
| 公开联系渠道 | 在当前源码、public 资源、根 README 和运维文档中未找到可公开的举报／支持渠道 | 实际邮箱／网址、负责人与 App 内及商店支持页展示待确认；没有拿私密开发者账号代替 |
| 反滥用 | 受控身份、字段边界、一目标一 pending | 缺跨目标服务端限流，需讨论共享业务和阈值；不在本票单方面决定新规则 |
| 处置与留存说明 | 现有证据快照及保留关联、私聊清理保护 | 隐私说明、证据范围／依据／期限、访问责任与注销冲突待核实，不能承诺无限留存或直接删除 |

上述缺口需要另行明确范围和责任；它们是发布前待办，不表示本票已实现或全部满足 1.2。本票未添加自动处罚、新审核产品、公开邮箱或管理员数据权限。

## Ticket 6：永久注销与证据删除依赖

- behavior_reports 保存 reporter_id、目标、原因与说明；report_evidence 保存 reported_user_id 和快照。消息快照含正文与会话，申请快照含附言／状态，资料快照含公开资料。它们虽不包含登录邮箱或认证凭据，仍可能包含个人信息。
- reporter_id／reported_user_id 不依靠账号外键级联删除。源内容或 auth 用户消失，不会自动删除原快照、UUID 和说明；源资料变化也不会覆盖快照。
- report_evidence 与 report_source_retention 有 UPDATE／DELETE 拒绝触发器；消息留存的生成列 message_id 对 messages.id 有 ON DELETE RESTRICT 外键。仅删账号／消息、置空 sender_id 或调用普通私聊清理不能完成注销。
- dismissed／actioned 状态不会自动释放留存。当前没有到期清理策略或已验证的依法保留期限；普通私聊“双方清除满 720 小时”不能套用为举报证据留存期限。
- Ticket 6 必须先核实可保留的范围、依据与期限，给出受控最小保留／脱敏／释放方案及失败恢复，再处理正文、快照、身份引用、说明、源内容外键与本机副本；不能绕过不可变触发器直接手工删，也不能以“证据不可变”永久保留所有内容。涉及既有举报／清理规则须先界定影响并讨论。
- 同时检查 App 内草稿／回执、运营导出与可控制副本；不能从举报快照重新恢复已注销用户正文。受控审核证据和普通聊天缓存分开授权。注销最终行为不在本票实现或验收。

相关实现：[举报历史交接](behavior-reporting.md)、[私聊清理](direct-message-cleanup.md)、[消息恢复](mobile-messages-api.md)；数据库为 `202609110004_reporting.sql`、`202609110005_direct_message_cleanup.sql`、`202609120002_admin_school_testing.sql` 及完整后续迁移链。没有新增迁移或依赖；部署需先核对目标迁移链，再发布移动后端，再联调原生页面。

## 验证状态

移动 HTTP 契约测试使用真实 Supabase SDK 和受控网络响应，验证认证、字段／目标／原因／说明、精确 ID、返回状态和不回传证据；真实权限由完整迁移链 PGlite 角色／RLS 测试验证，两者不能互相替代。

本次实际验证：移动举报 24 项；移动／共享举报回归 4 文件／31 项；移动／完整迁移链／举报／清理 4 文件／44 项。最终 `npm test` 105 文件／767 项通过 → build → lint → typecheck 依次通过；本地生产 HTTP 边界 7 项通过，覆盖认证、Cookie 冒充、错误授权、JSON 405／Allow 和 404，均 no-store、不设置 Cookie。轻量检查通过，阶段整体双轴审查另行记录，不把已知发布缺口标为通过。

本次没有向 CourseMate-test 或生产提交真实举报、修改审核状态／拉黑关系、发送通知或公开联系信息。托管 PostgreSQL 并发、真实账号、运营处理和 iOS 联调仍待验收；具体本次检查结果与阶段 review 见 STATUS 和 Notion Ticket 5。
