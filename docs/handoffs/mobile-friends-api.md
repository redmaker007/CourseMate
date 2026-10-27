# 移动好友接口与原生页面交接（Ticket 3）

日期：2026-10-25；实现起点 7334c01。此文件是本票后端契约与页面要求，当前状态见 [STATUS](../STATUS.md)。原生 UI、消息读写和真实设备联调不属于本票交付，不表示接口已部署。

## 身份、隐私与边界

- 基础路径 `/api/mobile/v1`，每次请求使用 [移动认证契约](mobile-auth-api.md)的 Bearer；服务端重新验证成员、当前学校和资料状态，不接受客户端指定操作人、学校或收件人账号。响应 private/no-store，无 Cookie；操作请求沿用 JSON 与 16 KiB 上限。
- 所有好友入口要求完成资料，未完成返回 403／onboarding_required。既有好友 service 与 RPC 拥有最终授权；没有增加 service_role 读取、表直接写入或数据库迁移。
- 精确邮箱发现只使用 POST JSON，结果不返回邮箱。原生端只在当前输入草稿中保留邮箱；不得放入 URL、持久缓存、分析事件、崩溃报告或日志。课程成员入口直接用 memberId 发起申请，不反查邮箱。
- 新发现、新申请和接受申请沿用当前学校规则。已有好友／申请／私聊历史可以跨学校保留，屏蔽偏好只属于当前账号；切校后仍有拒绝申请、拉黑／解除自己拉黑等既有自我保护例外。不能把“不支持跨校新发现”实现成删除历史或关闭全部自我保护入口。详见 [ADR-0006](../adr/0006-admin-cross-school-testing.md)。
- 本票只给出受权的既有会话标识。好友列表 sendStatus=allowed 仅反映该好友读模型中的拉黑限制，**不证明当前学校相同或完整消息发送资格**；原生端需使用 Ticket 4 的会话读写结果决定只读／可发送。本票没有交付该移动消息路径。

## 实际路径与请求

| 方法与路径 | 参数／JSON 请求体 |
|---|---|
| `GET /friends` | scope=visible（默认）或 hidden，limit、offset；两种 scope 互斥，不返回混合清单 |
| `GET /friends/{memberId}` | 本人现有好友详情，包含本人已屏蔽的好友；没有关系返回 404，不提供任意成员资料查询 |
| `GET /friends/blocked` | 仅本人主动拉黑的成员，含非好友；limit、offset |
| `POST /friends/search` | `{"email":"target@example.edu"}`；去首尾空格、转小写后精确发现同校成员；示例域名不代表已开放 |
| `GET /friend-requests` | direction=all（默认）／incoming／outgoing，status=all（默认）／pending／accepted／rejected／expired，limit、offset |
| `POST /friend-requests` | `{"memberId":"目标 UUID","message":"一起学习"}`；附言去首尾空格后 1–300 个 Unicode 字符 |
| `POST /friend-requests/{requestId}/respond` | `{"decision":"accept"}` 或 `{"decision":"reject"}`；由服务端验证本人是否为收件人 |
| `POST /friends/{memberId}/note` | `{"note":"搭子"}`；去首尾空格后最多 15 个 Unicode 字符，空字符串清除自己的备注 |
| `POST /friends/{memberId}/hide` | `{"hidden":true}` 屏蔽；false 解除屏蔽；必须是 JSON boolean |
| `POST /friends/{memberId}/block` | `{"blocked":true}` 拉黑；false 仅移除本人创建的拉黑，必须是 JSON boolean |
| `POST /friends/{memberId}/remove` | `{}`，解除好友关系；不删除双方历史，不替对方清空消息 |

详情不接受查询参数；POST 均不接受查询参数。未知／重复参数、缺少字段、额外的 userId／schoolId／recipientId、字符串布尔值、非法决定均返回 400。不要通过任意 RPC 名称或表名绕过这些路径。

## 分页、过滤与刷新

limit 默认 50，1–100；offset 默认 0，0–999999，均只接受十进制整数字符串。响应 page={limit,offset,nextOffset}，nextOffset=null 结束。后端在 RPC 结果上先过滤，再排序、偏移并多取一行，不是先取前一千人再在内存分页。

| 列表 | 顺序 |
|---|---|
| 好友／本人屏蔽好友 | effective_name ASC，member_id ASC |
| 申请 | created_at DESC，request_id DESC |
| 本人拉黑 | display_name ASC，member_id ASC |

各列表返回 schoolId，表示此次账号的当前业务学校，不代表历史中的所有联系人都属于该校。共同课程仍按现有 RPC 只显示当前学校、当前学期的动态交集，不是永久的好友来源记录。

分页是实时 offset，不提供事务快照、总数或删除游标。备注会改变好友顺序，关系变化／学期切换也可能改变条目。写操作成功、下拉刷新、恢复联网或过滤条件变化后从 offset=0 重读，以 memberId／requestId 去重。只在同一账号、学校与过滤条件的完整分页全部成功后对账移除；单页为空、失败或未翻到末页不能视为其他条目已删除。

## 字段与虚构示例

好友列表：

```json
{
  "status": "loaded",
  "schoolId": "uw-madison",
  "friends": [{
    "memberId": "22222222-2222-4222-8222-222222222222",
    "displayName": "同学",
    "effectiveName": "搭子",
    "avatarUrl": null,
    "major": null,
    "gradYear": null,
    "sharedCourses": [{
      "id": "55555555-5555-4555-8555-555555555555",
      "code": "CS 400",
      "title": "Programming III"
    }],
    "hidden": false,
    "sendStatus": "allowed",
    "blockStatus": "none",
    "conversationId": "44444444-4444-4444-8444-444444444444"
  }],
  "page": { "limit": 50, "offset": 0, "nextOffset": null }
}
```

- 好友详情：`{"status":"found","friend":上述单个好友项}`。displayName 是对方公开名称，effectiveName 是本人备注优先的显示名称，不改变对方资料。
- 找人成功：`{"status":"found","member":{...}}`，member 包含 memberId、displayName、avatarUrl、major、gradYear、sharedCourses、relationship、blockStatus、incomingRequestId。relationship 为 none／outgoing_request／incoming_request／friend／blocked；没有收到的待处理申请时 incomingRequestId=null。无邮箱、备注或 hidden 字段。
- 申请列表：`{"status":"loaded","schoolId":"...","requests":[...],"page":{...}}`。每项含 requestId、direction、otherMemberId、displayName、avatarUrl、message、status、createdAt、expiresAt、resolvedAt。日期为服务端时间字符串，未处理时 resolvedAt=null；ID 为 UUID。
- 主动拉黑列表：`{"status":"loaded","schoolId":"...","members":[...],"page":{...}}`。每项含 memberId、displayName、avatarUrl、activeFriendship、conversationId（可为 null）。它不列出“只有对方拉黑我”的非好友。
- 新申请成功：`{"status":"sent","requestId":"33333333-3333-4333-8333-333333333333"}`。接受成功：`{"status":"accepted","conversationId":"44444444-4444-4444-8444-444444444444"}`；拒绝为 rejected，备注／屏蔽／拉黑设置为 saved，清备注／解除本人拉黑为 cleared，删除好友为 removed。

以上数据均为虚构。新申请成功后沿用已有网页推送调度，只传服务器确认的 requestId，不能由客户端指定通知收件人；already_pending 不再次安排。推送附带失败不改变申请结果；它不是本票新增的原生好友申请通知能力。

## 状态、操作和反馈

### 发现与申请

| 服务端状态 | 可呈现的入口／反馈 |
|---|---|
| relationship=none 且无拉黑 | 输入附言，允许尝试发申请，仍由服务器验证 |
| outgoing_request | 已发申请，避免重复提交；刷新申请列表 |
| incoming_request 且有 incomingRequestId | 打开收到的申请；pending 才显示接受／拒绝 |
| friend | 打开好友管理及已有会话入口 |
| blocked 或 blockStatus 非 none | 不提供新申请／新消息成功提示；是否可解除本人拉黑按下表判断 |
| already_pending／already_friends／incoming_request | 关系已变化，展示实际状态并刷新，不把它当新申请发送成功 |
| expired | 申请已过期；本地时间仅作提示，最终由服务端判断 |
| not_recipient | 无权处理该申请，不返回正文或会话；重新加载本人列表 |

重复响应会返回**已有实际状态**：例如此前已接受的申请，本次点击拒绝也可能返回 accepted。页面应显示“申请已被接受”，不能因为用户点击了拒绝就显示“已拒绝”。接受会由数据库创建／复用唯一私聊，并将附言插入为首条消息；客户端不要另外伪造插入一条附言。

### 屏蔽与拉黑

| 字段／状态 | 含义与按钮 |
|---|---|
| hidden=true | 仅本人显示偏好；从普通好友视图移到屏蔽专门页，对方不获知；在专门页提供解除屏蔽 |
| blockStatus=none | 当前无任一方向拉黑；可按现有规则拉黑，不因此保证同校或可发送 |
| blocked_by_me | 提供“解除我设置的拉黑” |
| blocked_by_other | 本人不能解除对方设置；不显示假解除入口 |
| mutual | 只能解除本人方向；操作后必须重读，可能仍为 blocked_by_other |
| sendStatus=blocked | 任一方向拉黑限制双方新消息；保留关系与历史，不删除旧消息 |

屏蔽与拉黑互不替代。隐藏的好友仍可收发既有业务允许的消息，显示和通知继续按现有规则；拉黑不会自动删除好友或历史。删除好友不替对方清空历史，也不会保证清除既有主动拉黑。不要把好友列表消失当成消息正文永久删除。

## HTTP 与错误映射

| HTTP | status 与处理 |
|---|---|
| 200 | loaded、found、sent、accepted、rejected、saved、cleared、removed；按实际 status 和本次操作呈现反馈 |
| 400 | invalid、invalid_target、invalid_request；可能附 fieldErrors.message 或 fieldErrors.note；修正输入 |
| 401 | authentication_required、access_token_invalid；按认证契约刷新／重新准入 |
| 403 | onboarding_required、membership_denied；分别为补资料和成员准入失效；blocked、not_recipient 仅限制目标操作，不能据此锁定整个账号 |
| 404 | not_found、not_available、not_friends；目标不在允许范围或关系已变化，不伪造成功 |
| 409 | already_pending、incoming_request、already_friends、expired；重读实际关系／申请状态 |
| 429 | rate_limited；稍后重试，不承诺精确剩余秒数 |
| 503 | temporarily_unavailable；未知／畸形成功结果也按暂时故障处理，不暴露供应商错误或统一显示成功 |

统一入口另有 JSON 405、413、415；GET 找人不受支持。网络错误／503 不等于账号已失效；对写操作先重读最终关系，再决定是否重试。只有 status=sent 才显示“新申请已发出”，HTTP 200 本身不能替代字段判断。

## 原生页面与离线保存

1. 好友页：按 effectiveName 显示、保留 displayName 供说明；展示头像、共同课程及适当联系限制。普通列表与本人屏蔽页分开，分页失败保留已加载条目。
2. 新的朋友：收到／发出与历史分类，用服务端 direction、status 和 expiresAt 展示；只对收到的待处理申请提供接受／拒绝。发送中防重复点击，失败保留草稿，成功后刷新列表和好友状态。
3. 好友管理：备注、清备注、屏蔽、拉黑与删除使用不同按钮和准确说明。删除前说明解除关系而不替对方删除历史；所有按钮状态是提示，最终由服务端重新授权。
4. 屏蔽与拉黑页：屏蔽好友和本人主动拉黑成员为两个列表；普通好友中可展示对方造成的联系限制。允许通过好友详情重新读取被本人屏蔽的好友，不把“普通列表没有”误判为非好友。
5. SQLite 等持久缓存按 userId＋currentSchoolId 隔离，保存稳定 memberId／requestId／conversationId、显示字段、关系／限制快照、筛选条件和最后成功同步时间。不要持久化搜索邮箱、Bearer、OTP context 或未发送附言草稿；缓存不能充当在线授权。
6. 正常离线按既定账号规则阅读已保存列表和历史，明确标注快照及最后同步时间。申请、备注、屏蔽、拉黑和删除均需在线，不加入离线重放队列。恢复联网先验证身份，再刷新完整分页和目标状态；旧账号、旧学校、旧筛选请求不能覆盖当前缓存。
7. 主动退出时锁定原账号缓存、清凭据，重新联网登录同账号验证后才能读取。临时故障不误删好友或锁定整个账号。删除关系、屏蔽、拉黑的消息／未读／通知处理由后续消息与推送契约继续校验，不能靠本票快照绕过权限。

## 实现、验证与部署顺序

入口为统一移动 Route Handler → `src/features/friends/mobile-api.ts` → 既有 friendship-service／supabase-friend-backend／受控 RPC。好友网页入口、共享业务及 SQL 不改。分页解析与 Ticket 2 共用 `src/lib/mobile-pagination.ts`，课程行为保持兼容。

先核对目标数据库完整迁移链（含好友后端、好友页面只读查询、管理员当前学校、权限收口、既有网页推送），再部署接口并按本文件联调。没有新增迁移或必需环境变量；已有网页推送缺少配置时继续关闭，不影响好友操作。不要把本地实现误当作已在团队线上网址可调用。

本票的单元／模拟网络、既有真实 SQL 集成检查、托管账号联调、原生实现和真机结果分别记录在 STATUS 与 Notion Ticket 3；整阶段双轴 review 在阶段 2 后续 Tickets 完成后进行。

本次最终实际检查：移动好友定向 23 项通过；好友／网站／SQL 权限及跨校回归 6 文件／82 项通过；npm test 103 文件／718 项 → build → lint → typecheck 依次通过。本地生产构建 HTTP 边界 14 项通过，覆盖全部入口要求 Bearer、Cookie 不放行、找人 GET 被拒绝、未实现消息路径及 JSON／no-store／无 Cookie。只做本票轻量检查，未执行整阶段双轴 review。

本次未使用真实账号发送申请、修改远程好友关系或测试实际推送投递，没有做真实多连接竞态、原生缓存／iPhone 验收；未 push、合并或部署。Ticket 1 延期项目继续保留。
