# App 适配约定评审（2026-10-21）

评审对象：丹尼的《网页登录模块：App 适配预留约定》v1（基线 `origin/main` `e4be133`）。结论：**约定可以接受**。它没有要求现在写任何移动端代码，只要求网页端的认证、成员和资料逻辑保持可单独调用，并在合并前交一份交接说明。本页是对照当前代码的核对结果，不是已完成的实现；改动认证公共服务前，按约定第 5 节先和丹尼对齐范围。

## 路线澄清

约定采用 React Native + Expo **原生组件**，优先 iOS：界面重写，后端复用（同一个 Supabase 项目、账号、RPC、RLS）。这**不是套壳**。早先讨论过的 Capacitor 套壳（把现有网页包进壳）不再推进；PWA 继续作为网页与 Android 的渠道。

## 与代码对得上的地方

- 服务层已分层且结果是机器可识别的状态，不靠解析中文：`src/features/auth/email-otp-service.ts` 的 `EmailCodeRequestResult` / `EmailCodeVerificationResult`。
- 成员读取已区分「确定不是成员」（`null`）与「读取失败」（抛错）：`src/features/auth/member-session.ts` 的 `createMemberSessionReader().getMemberContext()`，返回用户 ID、邮箱、所属学校、当前学校、`onboardingComplete`。
- 学校以数据库为准，域名精确匹配；验证阶段绑定发码时的学校与邮箱（`email-otp-context.ts`，HMAC 签名，10 分钟，密钥至少 32 字符）。验证码为 6 位，有效期 600 秒，配置在 `supabase/config.toml`。
- 退出是当前设备：`supabase.auth.signOut({ scope: "local" })`。
- `service_role` 只在服务端使用，不进客户端，与约定一致。

## 差距清单（均已对照代码）

| # | 问题 | 位置 |
|---|---|---|
| 1 | 验证成功后成员校验未过或读取失败，一律丢弃会话并返回 `temporarily_unavailable`；约定要求「成员准入明确不满足」与「读取失败」分开 | `email-otp-service.ts` 的 `verified` 分支；端口 `MemberSessionPort.hasValidMemberSession()` 只返回布尔值，丢了原因 |
| 2 | `signed_in` 不带资料是否完善；网页登录后另行读取，原生端需要在结果里拿到，或紧接着调用 `getMemberContext()` | `EmailCodeVerificationResult` |
| 3 | 页面用的 `getCurrentMember()` 把异常收成 `null`，不能直接当作 App 的会话状态；原生接入层应直接用 `createMemberSessionReader` | `src/features/auth/session.ts` |
| 4 | 资料校验的 `fieldErrors` 键是字段名，值是中文句子；原生端只能按字段名判断，最好补错误码 | `src/features/profile/profile-service.ts` |
| 5 | `rate_limited` 没有等待时间（约定里是「有可信信息时一并提供」，可选） | `EmailCodeRequestResult` |
| 6 | 会话只写 Cookie，没有向原生端交付会话的出口；约定已承认，留给 App 接入层 | `supabase-email-otp-adapters.ts` 的 `verifyCode` |
| 7 | 新增任何移动 HTTP 路由，会被 `src/proxy.ts` 的全局 matcher 重定向到登录页；做法参考 `manifest.webmanifest`、`sw.js`、`offline.html` 的排除，不能取消网站保护 | `src/proxy.ts` |

## 建议与待定

- **「HTTP API 还是直连 Supabase SDK」尚未定案，它决定要不要把现有服务暴露成接口。建议：账号走直连 SDK，数据继续走现有 RPC 与 RLS。** 依据：权限本来就在数据库（RPC 以 `auth.uid()` 校验，`get_member_context` 对非本校域名关闭失败）；Before User Created 钩子在创建账号时就挡住非学校域名；再加一层 HTTP 更难做到「共享逻辑由一处维护」。这是需要团队决定的架构取舍，此处只是建议。
- 若走直连 SDK，要先补三个前提：① 服务层的 `matchesEnabledSchool` 前置检查在原生端会被绕过，只剩钩子兜底；② 资料规则（显示名 ≤15、毕业年份 2020–2040）要由数据库约束兜底，**现有约束是否足够尚未核实**；③ 访问令牌有效期是 900 秒（[ADR-0009](../adr/0009-verify-access-token-locally.md)），原生端用 SDK 自动刷新配合。
- **账号永久注销是 App Store 的硬要求**，约定把它划为单独任务，需要排期。
- 本地 SQLite 缓存除按账号隔离外，聊天内容建议加密存储。
- 网页推送（PR #57，目前关闭）只覆盖浏览器；原生 iOS 要走 APNs，需要在订阅表里扩展设备令牌类型，可沿用「由数据库推导收件人」的认领函数模式（[ADR-0010](../adr/0010-web-push-via-restricted-rpc.md)）。约定把原生推送划在本次范围之外。

## 后续

1. 与丹尼对齐上面差距清单的范围，确认哪些由网页登录负责人补。
2. 补完后按约定第 5 节交付交接 README，并回归网页原有登录、重新发码、资料完善、受保护页面与当前设备退出。
