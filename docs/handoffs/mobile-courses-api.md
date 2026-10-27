# 移动课程接口与页面交接（Ticket 2）

日期：2026-10-25。此文件说明本票实际实现的后端契约；当前代码与验证状态以 [STATUS](../STATUS.md) 为准。本票不实现原生页面或聊天消息 API，不表示接口已部署。

## 身份与依赖

- 基础路径 `/api/mobile/v1`，认证沿用 [移动认证交接](mobile-auth-api.md)：每次请求发送 `Authorization: Bearer <accessToken>`，不使用网页 Cookie、Server Actions、service_role 或客户端自报用户／学校。
- 成员必须完成资料；未完成返回 403／`onboarding_required`，原生端进入补资料页。使用可信成员的 `currentSchoolId`；管理员测试学校不等于其邮箱所属学校。
- 不新增依赖或数据库迁移。数据库须已应用仓库现有完整链，包含 `202609140001` 的会话惰性创建、`202609250001` 的成员上下文及 `202610050001` 的大厅课程 RPC。CourseMate-test 已补齐；上线前仍核对实际目标项目的迁移记录。
- 所有响应为 JSON，携带 `Cache-Control: private, no-store`，不设置 Cookie。应用自己的本地数据库需按下文显式保存；HTTP no-store 不代替原生缓存规则。
- GET 无请求体；POST 必须 `Content-Type: application/json`，请求体为 `{}`，沿用 16 KiB 上限。用户、学校、学期字段不能通过请求覆盖。

## 路径

| 方法与路径 | 用途与参数 |
|---|---|
| `GET /courses` | 本人已加入课程。`scope=current`（默认）或 `archived`；支持 `limit`、`offset` |
| `GET /courses/search?q=CS400` | 仅搜索当前学校的当前学期课程。q 去首尾空格后 1–120 个 Unicode 字符；支持 limit、offset |
| `GET /courses/{courseId}` | 当前学校的课程详情与有权限的会话入口；未加入时仅能查看当前学期课；已加入的旧学期课可只读查看 |
| `POST /courses/{courseId}/join` | 仅加入本校当前学期课程，请求体 `{}` |
| `POST /courses/{courseId}/leave` | 仅退出当前学期、未归档且已加入的课程，请求体 `{}` |

courseId 是 `courses.id` UUID，不是无学期的 `course_catalog.id`。schoolId 是学校 slug，term 为学期标识；课号、标题不能作为主键。客户端不传 schoolId、userId 或 term。未知／重复查询参数、畸形 ID、非法分页、非空操作请求体均返回 400／invalid_request。

## 分页与顺序

- limit 默认 50，范围 1–100；offset 默认 0，范围 0–999999，均只接受十进制非负整数字符串（limit 不能为 0）。响应 `page` 包含 limit、offset、nextOffset；nextOffset 为 null 表示该次查询无下一页。
- 本人列表按数据库 `code ASC, course_id ASC` 排序，scope=current 排除归档，scope=archived 返回归档；后端多读一行判断下一页。
- 搜索完全复用网站业务：精确课号 → 课号前缀 → 标题关键词 → 标题相似；同类别按相似度、课号、稳定 ID 排序。matchKind 为 exact_code、code_prefix、title_keyword 或 title_similar。原生端按服务端顺序展示，不自行重新匹配或排序。
- 每页同时返回当前学校与当前学期。未配置当前学期时列表／搜索成功返回空列表、currentTerm=null，详情与写操作不可用。
- 这是实时 offset 分页，不是数据库快照或游标。加退课、学校／学期切换、目录变化会使偏移改变；写操作后、下拉刷新和重新联网都从 offset=0 开始，按 id 去重。学校、学期或搜索词变化时丢弃旧分页进度。不能以单页缺失推断课程已退出或数据已删除。
- 搜索为保持网站匹配语义，会按 500 条分批读取当前学期目录并匹配后分页；接口分页不意味着数据库仅扫描该页。未在真实全量目录上做性能压测。

## 虚构响应示例

以下 ID 与内容均为虚构。列表：

```json
{
  "status": "ok",
  "schoolId": "uw-madison",
  "currentTerm": "2026-fall",
  "courses": [{
    "id": "22222222-2222-4222-8222-222222222222",
    "schoolId": "uw-madison",
    "code": "CS 400",
    "title": "Programming III",
    "term": "2026-fall",
    "conversationId": "33333333-3333-4333-8333-333333333333",
    "archived": false,
    "memberCount": 2
  }],
  "page": { "limit": 50, "offset": 0, "nextOffset": null }
}
```

搜索同样返回 status、schoolId、currentTerm、courses 与 page。搜索课程项是 id、schoolId、code、title、term、matchKind、joined；不包含聊天入口或成员数：

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "schoolId": "uw-madison",
  "code": "CS 400",
  "title": "Programming III",
  "term": "2026-fall",
  "matchKind": "exact_code",
  "joined": false
}
```

详情：

```json
{
  "status": "ok",
  "schoolId": "uw-madison",
  "currentTerm": "2026-fall",
  "course": {
    "id": "22222222-2222-4222-8222-222222222222",
    "schoolId": "uw-madison",
    "code": "CS 400",
    "title": "Programming III",
    "term": "2026-fall",
    "joined": false,
    "conversationId": null,
    "archived": false,
    "canJoin": true,
    "canLeave": false
  }
}
```

加入后重新请求详情，joined=true、conversationId 有值，canJoin=false、canLeave=true。归档课 canJoin/canLeave 均为 false，只对已加入成员提供已有会话入口。按钮字段是此次读取的提示，不能代替后续服务器授权。

写入成功分别只有 `{"status":"joined"}`、`{"status":"left"}`；成功后重新读取详情和列表。不自动创建新课，不在建课时提前创建空会话。首次学生加入时由既有数据库触发器创建唯一课程会话，后续加入复用该会话。

## 失败、重复与并发

| HTTP / status | 原生端处理 |
|---|---|
| 401 / authentication_required、access_token_invalid | 沿用认证交接的刷新及重新准入流程；自然过期不等于立刻锁定离线历史 |
| 403 / membership_denied | 明确成员准入失效，按认证契约锁定该账号并引导处理 |
| 403 / onboarding_required | 补全资料；不把它当网络错误自动重试 |
| 400 / invalid_request | 修正参数、课程 ID 或请求体 |
| 404 / not_available | 目标不存在、跨校、学期／成员／会话条件不满足；不披露其他学校课程是否存在 |
| 404 / not_found | 路径未实现；不能将文档草案当作已存在接口 |
| 405 / method_not_allowed | 调整方法；包含 Allow。GET／POST／PATCH／PUT／DELETE 均由统一入口处理；不要假设其他协议方法提供业务接口 |
| 413 / request_too_large；415 / unsupported_media_type | 调整请求体大小或 JSON Content-Type |
| 503 / temporarily_unavailable | 保留已有缓存，展示稍后重试；写操作先重读详情确认最终状态 |

沿用网页现有写入语义：重复加入导致唯一键冲突，返回 503，不另造幂等成功；重复退出在重新校验时未加入则返回 404。并发退出若已通过校验但另一个请求先删除，同一条受权 DELETE 删除零行仍可返回 left；最终状态应重新读取。RLS 在检查后仍会重新限制写入，检查与写入之间学期／权限变化可能产生失败，客户端不能仅根据按钮或旧响应认定成功。

数据库唯一键和每门课行锁保持原有并发保护。HTTP 模拟网络测试检查冲突分类，SQL 集成测试检查会话惰性创建和成员同步；未在真实 PostgreSQL 多连接下执行竞态压力测试。没有增加自动重放请求、幂等键或离线写队列。

## 原生页面与缓存要求

1. 课程首页：展示当前与归档分组、课号、名称、学期；已有本人列表项可展示成员数。显示加载、空、失败、离线缓存及最后成功同步时间，分页失败保留已加载内容。
2. 搜索页：输入搜索词后调用服务器；提示无匹配、已加入与可加入，不基于课号拼接 ID。离线时只允许查阅已保存结果，标明可能过时，关闭加退课。
3. 详情页：未加入只展示课程元数据与符合 canJoin 的加入按钮；加入成功重新取详情才导航到会话。已加入显示当前会话入口；归档只读，隐藏写操作。消息读取／发送及成员关系属于后续 Tickets，本票不交付这些移动路径。
4. 退出成功：立即移出当前本人列表、撤销课程聊天入口并锁定对应聊天缓存；清理订阅和页面导航中旧入口。服务器删除本人 course_members 并由触发器同步 conversation_members；再次读取当前课详情仍可看课程元数据，但 conversationId=null，不能继续查看成员内容。退出不删除服务器课程或其他人的历史。
5. 缓存按 userId＋currentSchoolId 隔离，以 courseId／conversationId 作稳定引用，附 scope、term、搜索词及最后同步时间。不要保存 Bearer、邮箱或 context 到课程数据表。正常离线且未主动退出时遵循既定离线阅读规则；缓存本身不能证明当前在线权限。
6. 联网先刷新及验证身份，再从首页 offset=0 重拉；完整列表加载成功后才用完整集合对账退出／移除，详情明确无权后立即锁定目标。分页失败不能把未读到的课程全部删掉。账号切换、当前学校变化、主动退出按认证交接锁定原账号缓存，后台旧请求不得写入新账号缓存。

## 实现与联调入口

- 入口：`src/app/api/mobile/v1/[...path]/route.ts` → 统一认证／JSON 边界 → `src/features/courses/mobile-api.ts`。
- 搜索复用 `course-service.ts`；数据库查询抽到 `supabase-course-search.ts`，网站继续使用相同调用约定。加退课复用 `course-operations.ts` 与 `supabase-course-operations.ts`，网页工厂只负责 Cookie 会话适配。
- 先迁移核对 → 部署本票后端 → 前端使用上述真实路径联调；本地新增接口不会自动出现在团队线上网址。
- 联调至少覆盖：跨校、未补资料、搜索排序与多页、加入后才有会话、退出后入口撤销、归档只读、重复请求／并发、网络失败保留缓存。原生缓存和真机结果必须单独记录，不能用接口测试代替。

## 本次验证证据与未完成项

实现起点 bd1d557，分支 feature/mobile-auth-api。移动课程真实 SDK／模拟网络回归 22 项通过，包含当前学校、跨校、旧学期与归档、身份／资料准入、搜索顺序、分页、重复加入与模拟并发冲突、退出后入口、输入与服务故障。定向课程／认证／真实 SQL 生命周期回归在增加最后一项并发用例前为 7 文件／95 项通过；后续完整检查包含最终版本的全部用例。

最终实际检查顺序：npm test（102 文件／695 项通过）→ npm run build → npm run lint → npm run typecheck，均通过。本地生产构建 HTTP 检查 7 项通过：五个课程入口均要求 Bearer，伪造 Cookie 不放行，DELETE courses 返回 JSON 405，未实现课程消息路径 JSON 404；均 no-store、不设置 Cookie。

本票仅完成轻量自检，整阶段双轴 review 随阶段 2 后续 Tickets 完成后执行。没有部署移动 API，没有在远程测试库使用真实成员加退课，没有执行 PostgreSQL 多连接竞态或 iPhone 原生缓存验收；不把本地模拟并发结果写成远程竞态通过。Ticket 1 延期测试继续保留。
