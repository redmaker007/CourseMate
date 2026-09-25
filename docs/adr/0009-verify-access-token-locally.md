# 成员会话本地验签，并把令牌有效期缩到 15 分钟

每个受保护请求都要先确认"这个人的登录有效吗"，一次页面渲染里 proxy 和页面还各确认一次。原来用 `auth.getUser()`，每次都向 Supabase Auth 服务器往返一次（约 75–85ms）。2026-09-25 在延迟显示里量到「服务」读数约 255ms，函数自身只多约 12ms，主要就是这些串行往返；合并读取（[202609250001](../../supabase/migrations/202609250001_member_context_rpc.sql)）之后降到平均约 170ms，剩下最大的一块就是这次 `getUser()`。

## 决定

- 会话读取器改用 `auth.getClaims()`（[supabase-email-otp-adapters.ts](../../src/features/auth/supabase-email-otp-adapters.ts) 的 `getVerifiedUser`）：令牌是 ES256 非对称签名（新项目日志里核对过，带 `kid`），在本地用缓存的项目公钥验证签名与有效期，不再调用 `/auth/v1/user`。公钥缓存是 `auth-js` 里全局的（10 分钟），每个新的函数实例第一次拉一次。
- **每次请求仍然经 `get_member_context` 读取成员账号**，所以在后台删除用户仍然立即生效：成员账号随用户级联删除，读不到就是未登录。
- Supabase 后台 **Authentication → Sessions → Access token expiry time 设为 900 秒**（默认 3600）。这是"令牌被撤销后最长还能用多久"的上限，见下面的代价。

## 为什么可以接受

| 情形 | 原来 `getUser()` | 现在 `getClaims()` |
|---|---|---|
| 令牌被伪造 / 篡改 / 过期 | 拒绝 | 拒绝（本地验签，有测试） |
| 后台删除用户 | 立即失效 | 立即失效（成员账号读不到） |
| 退出**当前设备** | 立即失效 | 立即失效（cookie 被清掉） |
| 在**别处**退出登录 / 撤销会话 | 立即失效 | 令牌过期前仍可用，最长 15 分钟 |

目前项目里没有封号、远程踢人或强制下线，唯一受影响的是"别处退出登录"这一种。Supabase 文档也明确：退出登录只会删除数据库里的会话记录，已签发的令牌本身不会被主动作废。

`getClaims` 自带降级：遇到未知的 `kid` 或旧式对称签名（HS256），**不在本地信任，自动退回向 Auth 服务器确认**。所以万一以后换回旧密钥，只是变慢，不会变得不安全。用真实的 `auth-js` 与真实的 ES256 签名验证了这些行为（[测试](../../src/features/auth/supabase-claims-verification.test.ts)）：合法令牌本地通过且从不调用 `/auth/v1/user`；篡改内容、冒用 `kid`、`alg=none`、过期令牌都被拒绝；HS256 与未知 `kid` 退回服务器确认。

## 代价

- "别处退出登录"最长 15 分钟后才失效。**这个上限依赖后台的令牌有效期设置**：新建或搬迁 Supabase 项目时必须重新设置（不在 dump 里，见[新建项目手册](../runbooks/new-supabase-project.md)第 5 步）。
- 令牌更短意味着更频繁的刷新，每 15 分钟一次，可以忽略。
- 依赖项目使用非对称 JWT 签名密钥；否则每个请求会退回网络确认，退化到原来的速度。

## 没有做的更强方案，以及什么时候该做

Supabase 文档建议的做法：检查令牌里的 `session_id` 是否还在 `auth.sessions` 表里。把它加进 `get_member_context` 的同一次查询里，是一次主键查找，**没有额外网络往返**，就能恢复"退出登录立即失效"，不再依赖缩短有效期。代价是要再加一条迁移，函数需改成 `security definer` 才能读 `auth.sessions`。

现在没做，因为当前风险窗口只有 15 分钟且没有封号等功能。**一旦加入封号、远程踢人、强制下线这类功能，或者要求"退出登录立即失效"，应当做这个方案，而不是继续缩短有效期。**

## 相关

- 实现与测试：PR #37；[supabase-claims-verification.test.ts](../../src/features/auth/supabase-claims-verification.test.ts)
- 合并读取：[202609250001_member_context_rpc.sql](../../supabase/migrations/202609250001_member_context_rpc.sql)
- 当时的证据与发布记录：[发布交接 2026-09-25](../handoffs/release-20260925.md)
