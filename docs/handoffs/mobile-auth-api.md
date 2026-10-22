# 移动认证与资料 HTTP API（Ticket 1）

更新：2026-10-22。适用于 React Native + Expo iOS 接入。采用已确认的方案 A：客户端请求本站 HTTP API，后端复用既有 Supabase Auth、验证码业务、可信成员读取、资料服务与 RLS。网站继续使用 Cookie／Server Actions。

本文描述已写入本分支的接口；本地验证证据见下方。尚未部署，不将路径存在等同于线上已可调用。原生页面、凭据安全存储、离线缓存和真机验收由相应客户端任务完成。

## 请求约定

- 基础路径 `/api/mobile/v1`，生产必须使用 HTTPS。原生端配置站点地址；不依赖 Next.js Server Actions 或网页跳转。
- POST／PATCH 使用 `Content-Type: application/json`，请求体最多 16 KiB。所有列出的字段必须是字符串；拒绝未知字段、数组和非法 JSON。退出发送空对象 `{}`。
- 受保护请求用 `Authorization: Bearer <accessToken>`。只从本次请求读取身份，忽略网站 Cookie；缺失凭据不跳转 HTML。令牌不得放在 URL、日志或分析事件里。
- 成功及业务失败由 JSON 的 `status` 判断，同时检查 HTTP 状态。所有业务响应均 `Cache-Control: private, no-store`，不设置登录 Cookie。
- 这些是本阶段原生入口，尚不授权 App 调用其他现有 Cookie API。后续课程、好友及消息接口各自适配和验证。

## 端点

| 方法与路径 | 输入 | 成功输出 |
| --- | --- | --- |
| GET `/schools` | 无 | `status: "ok"`、`schools`：`id/nameEn/nameZh/emailDomains` |
| POST `/auth/request-code` | `schoolId`、`email` | `code_sent`、规范化的 `schoolId/email`、`context`、`resendAfterSeconds: 60` |
| POST `/auth/verify-code` | `context`、`code` | `signed_in`、`member`、`session` |
| POST `/auth/refresh` | `refreshToken` | `refreshed`、`session`；不返回成员准入结论 |
| GET `/session` | Bearer | `ok`、`member` |
| GET `/profile` | Bearer | `ok`、本人 `profile` 或 `null` |
| PATCH `/profile` | Bearer；`displayName/major/gradYear` | `saved`；无 Cookie 更新或网页跳转 |
| POST `/auth/sign-out` | Bearer；`{}` | `signed_out` |

匿名发码与验证码校验一般不附 Bearer。若提供了现有有效成员会话，复用原业务返回 `already_signed_in`，客户端再 GET `/session`；切换账号前先退出。刷新入口只消费请求体的刷新凭据，忽略 Authorization，以免过期的访问令牌覆盖新会话。

`schoolId` 是学校目录返回的字符串主键（例如 `uw-madison`），不得自行推导。域名精确匹配数据库配置，不自动接受子域名。`resendAfterSeconds` 是与现有网站一致的 60 秒界面等待提示，实际限流由 Supabase 配置执行；客户端倒计时不能代表服务端已允许发送。部署时沿用并核对现有 OTP 配置：六位数字、10 分钟有效、发码间隔不少于 60 秒。

`context` 是服务器签名、10 分钟到期的发码上下文，固定学校与邮箱。它经过签名而非加密，可能包含邮箱；只用于本次流程，不记录或当作长期会话。改学校／邮箱、上下文过期或验证码失效时返回发码步骤；重新发码可再次调用 `/auth/request-code` 并使用新返回的上下文。客户端不要向校验接口额外传学校或邮箱。

## 会话与可信成员数据

`session` 只包含：

```json
{
  "accessToken": "<虚构的访问凭据>",
  "refreshToken": "<虚构的刷新凭据>",
  "expiresAt": 1800000000,
  "tokenType": "bearer"
}
```

`expiresAt` 是 Unix 秒。客户端安全存储和完整替换凭据，不能只更新访问令牌而保留旧刷新令牌。不得直接照抄示例值。

`member` 包含 `userId/email/homeSchoolId/currentSchoolId/onboardingComplete`。`userId` 为稳定 Auth 用户 ID，用于账号隔离；邮箱属于私密身份信息，不当作公开资料。普通成员的当前学校等于归属学校；现有管理员跨校测试语义保持不变。

验证码通过后，后端仍检查成员账号、邮箱对应开放学校和学校绑定；失败不交付凭据，并尝试结束刚建立的当前会话。`onboardingComplete: false` 的合法成员可读取／填写本人资料；客户端应进入资料完善页，不能直接进入主应用。后续业务接口仍须独立检查身份与业务权限。

`profile` 为 `displayName/major/gradYear/avatarUrl`；无资料返回 `null`。保存只接受 `displayName/major/gradYear`：显示名必填且最多 15 个字符，专业最多 80 个字符，毕业年份为空或字符串 `2020`–`2040`。可选项使用空字符串。`userId` 不接受客户端指定。沿用现有 insert、遇到唯一冲突再 update，避免 upsert 所需读取权限导致 onboarding 失败。

## 客户端必须实现的顺序

1. 首次登录：读取学校 → 发码 → 保存当前流程的 context → 验码 → 安全保存整对 session → 按 member 决定 onboarding 或主页面。
2. 恢复联网或访问令牌过期：同一会话只运行一个刷新请求；刷新成功先原子保存新凭据，再 GET `/session` 验证成员，最后同步业务数据。即使后续成员读取超时，也不能丢弃刚轮换的新刷新凭据。
3. 刷新只更新认证凭据，不代表重新通过 CourseMate 准入；必须完成成员验证。后续所有业务操作仍由服务端与 RLS 授权。
4. PATCH 保存资料成功后重新 GET `/session`，取得数据库确认的 onboarding 状态，再进入主应用。不要根据客户端草稿自报资料已完善。
5. 主动退出：先阻止导航及通知访问本账号数据、锁定该账号缓存，并用当前访问令牌请求退出。确认成功后清理凭据。远端失败返回 503，不得声称已经撤销；客户端保持本地锁定，需设计受保护的待撤销重试，不能把待重试凭据恢复成已登录状态。原生存储与失败恢复尚待客户端实现。

退出接口使用用户 JWT 调用 Supabase `/logout?scope=local`，不使用 service role，不撤销其他设备、不删账号或云端历史。本接口可在成员准入失效后调用，不要求成功读取成员资料。若访问凭据已经过期，应先按会话恢复结果处理。

沿用 ADR-0009 的撤销边界：Supabase 撤销会话及刷新能力后，已经签发的访问 JWT 仍可能在过期前被接受。成员被删除后，成员读取拒绝访问；不能承诺所有被复制的访问令牌立即失效。部署项目应保持既定 900 秒访问令牌有效期；该设置须在真实环境核对。

## 错误与本地缓存

| HTTP／status | 客户端动作 |
| --- | --- |
| 400 `invalid_request` | 修正字段、字段类型或请求格式，不自动循环重试 |
| 400 `invalid_email` | 学校／邮箱格式或资格不满足，回到输入 |
| 400 `invalid_or_expired_context` | 重新发码，不能修改旧 context |
| 400 `invalid_or_expired_code` | 提示验证码问题，允许按限流规则重新发码 |
| 400 `invalid` + `fieldErrors` | 显示资料字段错误 |
| 401 `authentication_required` | 此请求未提供 Bearer；不是账号已经被服务器撤销的证据 |
| 401 `access_token_invalid` | 无法使用该访问凭据；先尝试刷新，不能单凭此结果删除或永久锁定离线历史 |
| 401 `session_invalid`（刷新） | 刷新凭据明确失效，停止使用会话并要求联网重登；锁缓存，不自动删除历史 |
| 403 `membership_denied` | 已完成读取但成员或学校准入不满足；锁对应缓存并显示不可用／重登入口 |
| 429 `rate_limited` | 显示稍后重试；未提供精确 Retry-After，不能承诺固定秒数后一定成功 |
| 503 `send_failed`／`temporarily_unavailable` | 可恢复故障，身份结论未知；保持本地已授权离线阅读规则，不误判账号失效 |
| 404／405／413／415 | 路径／方法／体积／媒体类型错误，修正调用；405 的 Allow 列出该路径支持的方法 |

用户未主动退出时，长期离线或令牌自然过期不单独锁定已缓存历史。主动退出后缓存保留但锁定，必须联网重登同一账号且成员校验通过才恢复；不同账号不能互读。以上客户端保护仍属于原生前端任务，本票只提供所需身份和错误语义。

## 代码、配置与验证边界

- 入口：`src/app/api/mobile/v1/[...path]/route.ts`。
- 协议与编排：`src/features/auth/mobile-api.ts`；生产适配：`production-mobile-api.ts`。
- 复用：`email-otp-service.ts`、`email-otp-context.ts`、`member-session.ts`、`supabase-email-otp-adapters.ts`、`sign-out-service.ts`、`profile-service.ts`。
- 共用资料数据库写入抽到 `src/features/profile/supabase-profile-service.ts`，网站生产入口继续调用同一实现。
- Proxy 只对 `/api/mobile/v1/` 前缀放行到独立鉴权的路由；相似前缀及网页保护不放开。
- 环境变量沿用 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、服务端 `EMAIL_OTP_CONTEXT_SECRET`（至少 32 字符）。App 只需要本站 URL；不会获得 HMAC 密钥或 service role。
- 本票无数据库迁移、无新增依赖。沿用 `supabase/README.md` 的部署与权限要求；不能使用此文档替代已有 Auth Hook、学校配置或数据库迁移链。
- HTTP 契约测试使用真实 Supabase SDK 与模拟网络，覆盖发码、校验、成员准入、刷新、资料和退出；加上 Proxy 边界和既有密码学／业务／数据库测试。它们不能证明真实邮件送达、托管 Supabase 配置或 iPhone 行为。
- 真实环境联调仍需受控测试账号验证：真实 OTP、刷新轮换和响应丢失恢复、多设备独立退出、资料/RLS、900 秒 JWT 配置及无凭据泄漏。没有真实凭据时不以模拟测试代替这些验收。

完整测试、构建、lint、类型检查和阶段 review 的本次证据在 `docs/STATUS.md` 与 Notion Ticket 1 记录；未完成检查保持未验收。
