# 移动聊天、可靠发送与缓存恢复交接（Ticket 4）

日期：2026-10-25；实现起点 67f3d6e，分支 feature/mobile-auth-api。当前状态见 [STATUS](../STATUS.md)。此文件描述本票实际后端契约与原生实现要求；不表示已部署或已完成客户端、推送投递、永久注销及真机验收。

## 数据流与权限

统一移动入口验证 Bearer／成员／资料 → 当前用户 Supabase 客户端 → 既有 RLS 读取或受控 RPC 写入 → JSON 响应。沿用 [认证](mobile-auth-api.md)、[课程](mobile-courses-api.md)和[好友](mobile-friends-api.md)契约。Cookie 不作为身份，客户端不能指定发送者、操作人、学校、收件人或 RPC 名称。

- 未完成资料返回 403／onboarding_required；跨账号私聊、未加入或已退出的课程、错误当前学校等由实际 RLS 与 RPC 拒绝。没有 service_role 读取，也没有 messages 直接写权限。
- 课程按当前学校与成员身份读取，归档可读但不可发送。私聊保留参与者历史；双方任一拉黑禁止新消息，解除好友或切校后可能只读。个人屏蔽只改变本人普通／专门列表，不等于禁止发送或删除历史。
- 读取消息显式排除 deleted_at 非空，并受个人清除游标 RLS 限制（[ADR-0008](../adr/0008-permission-hardening-and-direct-message-visibility.md)）。发送只经过原有 send_conversation_message；个人已读／清除只用原有受控 RPC。
- HTTP 响应 private/no-store、不设置 Cookie。POST 必须 JSON，沿用 16 KiB 上限；所有未知字段／查询、重复查询和错误数据类型拒绝。没有新增数据库迁移、依赖、离线发送队列或原生页面。

## 实际路径

基础路径 `/api/mobile/v1`，全部要求 Bearer。

| 方法与路径 | 用途／请求 |
|---|---|
| `GET /conversations` | kind=direct（默认）或 course；direct 的 scope=visible（默认）／hidden，course 的 scope=current（默认）／archived；limit、offset 与 Ticket 2／3 相同，默认 50、最大 100 |
| `GET /conversations/unread` | 本人私聊 visible／hidden 未读汇总，不接受查询参数 |
| `GET /conversations/{id}` | 访问及真正发送资格、本人已读／清除位置和当前最新可见消息 ID；不接受查询参数 |
| `GET /conversations/{id}/messages` | 最近消息、before 向前历史或 after 向后补拉；limit 默认 50，1–200；after 时可用 through 固定本轮上界 |
| `POST /conversations/{id}/messages` | `{"clientMessageId":"UUID","body":"hello"}`；新意图生成新 UUID，正文 trim 后 1–4000 Unicode 字符 |
| `POST /conversations/{id}/read` | `{"throughMessageId":"9"}`；只支持私聊，本人单调推进已读位置 |
| `POST /conversations/{id}/clear` | 同上；只支持私聊，本人单调推进个人清除位置，不删除对方历史 |
| `POST /conversations/{id}/reconcile` | `{"messageIds":["8","9"]}`；1–200 个不重复的已缓存服务器 ID，返回本次仍可见的权威消息及应移除的输入 ID |

POST 不接受查询参数。当前课程业务没有个人已读／清除功能，针对课程调用 read／clear 返回 403／not_allowed；本票不扩展这项业务。

## 会话列表和状态

列表返回 `status=loaded`、schoolId、conversations、page={limit,offset,nextOffset}。排序／过滤在数据库完成，多读一行判断末页。

- direct 列表沿用网站的**当前好友会话**范围，按 effective_name、member_id 升序；hidden 与 visible 分开。项目：conversationId、kind=direct、memberId、title（本人备注优先）、hidden、unreadCount（字符串）。已解除好友的历史可能不在此列表，但已知 conversationId 仍须通过状态接口确认能否只读；不要因列表缺失就删除历史。
- course 列表复用本校本人课程，按 code、course_id 升序；项目：conversationId、kind=course、courseId、title、term、archived。课程未读没有被新增为本票功能。
- `/conversations/unread` 返回 `{"status":"loaded","counts":{"visible":"2","hidden":"1"}}`，仅本人私聊汇总。
- 列表不是访问凭据或事务快照。写操作、备注重排、关系／学校变化后从 offset=0 重读；只在同条件完整分页成功后对账。真正发送资格取状态接口并由发送 RPC 再校验。

状态响应示例（全部 ID 与数据为虚构）：

```json
{
  "status": "loaded",
  "conversation": {
    "conversationId": "22222222-2222-4222-8222-222222222222",
    "kind": "direct",
    "archived": false,
    "lastReadMessageId": null,
    "clearedThroughMessageId": "9",
    "latestMessageId": "9007199254740993",
    "otherMemberId": "33333333-3333-4333-8333-333333333333",
    "otherDisplayName": "同学",
    "hidden": false,
    "sendStatus": "allowed"
  }
}
```

course 状态改为 courseId、hidden=false、sendStatus=allowed／readonly，不返回对方成员字段。direct 的 sendStatus 为 allowed／blocked／readonly，已综合现有好友、双方拉黑与当前学校条件；这比好友列表中的拉黑提示更完整。按钮字段只是此次读取的提示，最终由写入 RPC 决定。

## ID、消息分页与幂等

所有消息 ID、游标、已读／清除位置、未读计数都以**十进制字符串**传输；消息 ID 为正 PostgreSQL bigint（最大 9223372036854775807）。before 必须正数；after／through 可为 "0"。latestMessageId="0" 表示当前没有可见消息，个人游标没有值时为 null。不能转为 JS number 后再 String，大小比较也不能按字典序；使用不丢精度的整数方式。

before 与 after 互斥；through 仅用于 after，且 after≤through。无游标取最近一页。服务器按数值 ID 查询，**响应 messages 始终按 ID 升序**，每项包含 id、clientMessageId（可 null）、conversationId、senderId（可 null）、senderDisplayName、body、createdAt。昵称无法读取时为“成员”，发送者为空时为“已注销用户”；这不等于已经实施永久注销。

分页响应示例：

```json
{
  "status": "loaded",
  "messages": [{
    "id": "9007199254740993",
    "clientMessageId": "55555555-5555-4555-8555-555555555555",
    "conversationId": "22222222-2222-4222-8222-222222222222",
    "senderId": "11111111-1111-4111-8111-111111111111",
    "senderDisplayName": "本人",
    "body": "hello",
    "createdAt": "2026-10-25T00:00:00Z"
  }],
  "page": { "direction": "after", "limit": 50, "nextCursor": null, "through": "9007199254740993" }
}
```

nextCursor 非 null 时，在同方向、同 through 下继续；before 使用当前页最小 ID，after 使用最大 ID。末页 null 只表示本次观察的窗口结束，不代表以后没有新消息或删除。

发送返回 `{"status":"sent","message":上述权威消息项}`。超时后在同会话、同 trim 后正文下重用原 clientMessageId；重复请求返回原消息，不新增一条。相同账号的 UUID 唯一约束跨会话，换正文／会话必须生成新 UUID，否则返回 409／idempotency_conflict。不要为每次网络重试生成 UUID，也不要自动把冲突当新消息重发。

移动入口在原 RPC 回执之后还检查当前 RLS 可见性。如果幂等消息已被本人清除、标记删除或当前不再可见，返回：

```json
{
  "status": "sent_not_visible",
  "messageId": "9007199254740993",
  "clientMessageId": "55555555-5555-4555-8555-555555555555",
  "conversationId": "22222222-2222-4222-8222-222222222222"
}
```

它是 HTTP 200 的“已处理但当前不可展示”确认，**没有正文**；结束对应 pending 项，不插回聊天或显示“新消息刚发送”。共享旧 RPC／网页行为未改。幂等依赖现有消息行的唯一键，消息物理清理后没有永久 UUID 墓碑；清除／删除后的旧失败项不得自动重放，超长保留与永久删除边界由 Ticket 6 联合核验。

发送确认与补拉可能乱序到达：服务器消息按 id 去重，同 id 用新权威字段覆盖；pending／失败草稿单独按 clientMessageId 管理，收到匹配本人发送者＋clientMessageId 的服务端消息后消掉对应项。pending UUID 不能混入只接受 bigint 的消息排序器。迟到确认也必须检查当前清除游标和同步代次，不能复活已清除正文。

## 联网恢复与删除校验协议

本票提供 HTTP 补拉，不新增 Realtime 依赖。原生端可用轮询；如以后订阅 INSERT，仅把通知当补拉提示，不能直接当消息真相或删除同步。

1. 先按认证契约刷新并验证账号。绑定本次请求的 userId、currentSchoolId、会话和本地同步代次；账号／学校切换、退出、清除与重新同步时丢弃旧代次返回，避免旧请求覆盖新缓存。
2. 对每个已缓存会话读取状态。明确 404／not_available 时锁定该会话内容并停止发送／订阅；不能据此物理删除整个账号缓存。503／网络失败保留缓存并标为未同步，不当作账号或会话已失效。
3. 应用本人 clearedThroughMessageId：移除该会话中 ≤该位置的正文和相应旧 pending 引用。清除只影响本人；成功 clear／read 只返回 updated，之后重读状态获取实际单调位置，不能把旧响应反向覆盖新位置。
4. 将**所有已保存服务器消息 ID**按不超过 200 个逐批提交 reconcile，而不只校验屏幕上的一页。成功响应的 messages 是权威替换；removedMessageIds 仅针对本批输入，应移除这些旧正文和旧预览，不能再从另一张缓存表恢复。目标无权和临时故障不会返回整库清空指令。
5. 补拉不能永久只依赖“当前最大 ID”：数据库序列分配顺序不等于事务提交顺序。保存已加载区间的下界覆盖点（排他 after 游标，位于最早覆盖 ID 之前，用精确整数计算）；联网恢复和周期性重同步从该下界重新扫描。若历史已读到末端，下界设为 0；删除缓存行后也不能把覆盖下界悄悄抬高。取状态 latestMessageId 作本轮 through，上界固定，after 从覆盖下界开始逐页扫描，按 id 合并。这样迟提交的较小 ID 会在后续扫描被发现。
6. 活跃时可频繁 after 最大已知 ID 拉新，但必须定期重复步骤 2–5，不能用增量轮询替代它。打开缓存会话、前台恢复、重连和自己清除后都触发完整校验；其他缓存会话需分批恢复校验。网络／权限与删除是持续变化的，这不是跨请求原子快照，也不保证即时远程清除离线设备。
7. 同一会话的重扫、分页、校验和清除结果需串行合并或使用本地代次淘汰旧响应，避免 reconcile 删掉正文后，较早发起的历史响应又把它写回来。只有完整同步成功后更新“最后同步时间”；失败保留完成范围并重试，不伪造全量成功。

reconcile 示例：

```json
{
  "status": "reconciled",
  "conversationId": "22222222-2222-4222-8222-222222222222",
  "messages": [],
  "removedMessageIds": ["8", "9"]
}
```

这只表示这些输入 ID 在本次会话／调用者视角下不可见，不能据此声称“别人也删除了”。它覆盖个人清除和既有软删除／物理缺失的读取结果。**Ticket 6 必须接入并验证**永久注销清理、受控占位／正文移除、账号与推送失效及所有缓存副本更新；不能仅将 senderId 置空却保留应删除正文，也不能以本接口存在宣称永久注销已完成。本票未实现注销或远端主动删除通知流。

## 状态与错误

| HTTP | status／处理 |
|---|---|
| 200 | loaded、sent、sent_not_visible、updated、reconciled；按实际字段处理，不把所有 200 都插入新消息 |
| 400 | invalid_request、invalid_body、invalid_cursor；修正 UUID、字符串 ID、窗口、字段或正文 |
| 401 | authentication_required、access_token_invalid；按认证契约刷新，不因自然过期立即锁离线历史 |
| 403 | onboarding_required／membership_denied 按认证契约处理；not_allowed 只限制目标操作，不锁整个账号 |
| 404 | not_available 表示该目标当前不可访问；未知路径 not_found；不能显示其他账号会话内容 |
| 409 | idempotency_conflict；保留草稿，用户确认为新意图时才换 UUID |
| 503 | temporarily_unavailable；保留缓存和失败项，不返回删除列表或误判账号失效 |

JSON 405／413／415 沿用统一入口。只有查询成功的 reconcile 才可应用移除集合；读取失败不能当“全部消息已删除”。

## 页面、推送与验证分工

原生聊天页需显示最新消息、历史分页、pending／失败／重试、离线与最后同步时间、blocked／readonly／archived 状态和私聊个人清除入口。课程页、好友页进入聊天前重新读取会话；通知跳转也不能绕过身份与目标访问。屏蔽的私聊放专门列表，拉黑保留历史但关闭新发送，解除自己拉黑后重读真实状态。

本机数据按账号和当前学校隔离，永久保存需求遵循既定退出锁定／离线可读规则；没有离线发送队列或自动重放。允许在线用户手动重试原失败意图，但清除／删除后作废旧失败项，不能把保留草稿误当重新授权。

direct 的确认发送继续复用已有网页私信推送调度，事件 ID 与目标由服务器确认；重复回执复用原事件，发送器按既有受控认领去重。course 不推送。本票不新增原生推送 token／证书，原生推送由 Ticket 7 实施，实际投递未验收。

实现入口：统一移动 Route Handler → `messages/mobile-api.ts` → `mobile-message-data.ts` 的 RLS 读取及既有发送／已读／清除 service／RPC。没有 schema 修改；部署前仍须核对目标数据库完整迁移链，特别是可靠发送、个人清除与 `202609150001` 的直接 SELECT 权限收口。先部署后端，再按本文件实现和联调原生页面。

## 本次验证与交付边界

2026-10-25 本地实际验证：移动聊天定向 23 项，完整迁移链 SQL 7 项；最终 `npm test` 104 文件／742 项通过，随后 build、lint、typecheck 依次通过。生产构建本地 HTTP 10 项通过：全部 8 个消息入口拒绝 Cookie 冒充 Bearer，错误方法／路径为 JSON 405／404，响应均 no-store 且不设置 Cookie。

HTTP 合约测试使用真实 Supabase SDK 的受控网络响应，不能替代权限证明；SQL 测试在 PGlite 执行完整迁移链及真实角色／RLS，验证非参与者、退课、拉黑、个人清除、deleted_at、幂等与冲突。大于 JS 安全整数范围的 ID 保留精度；移动回执另测清除后重试不返回正文。

本票为后端已实现、待阶段 review；未 push、合并、部署、写远程消息或执行真实账号／iOS 联调。托管 PostgreSQL 多连接竞态、网页推送投递、原生渲染／本机缓存及永久注销最终行为仍待各自验收；Ticket 1 延期项继续保留。整阶段审查在阶段 2 的 Tickets 2–5 完成后进行。
