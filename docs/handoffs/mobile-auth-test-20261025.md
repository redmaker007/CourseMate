# 移动认证测试环境记录（2026-10-25）

本记录只报告此次实际操作。初测代码基线 `e79513e`，真实 OTP 联调使用修复后的 `bb28961`，隔离工作树 `tmp/app-readiness`，分支 `feature/mobile-auth-api`。接口在本机 `127.0.0.1:3101` 运行，连接远程测试 Supabase；没有发布到托管前端。

## 环境与配置

- 用户在 Supabase Dashboard 指定 CourseMate-test 为测试环境，ref `cqrlxcxcgrcoamqnjkwu`，区域 us-west-2。生产 CourseMate-main（`xpmkpkplftgtfzecdwpd`）未修改。
- 测试库原为旧项目快照，已有真实账号。保留现有记录；没有重置数据库或删除用户。初测未发送邮件；随后仅使用用户明确提供并能收信的学校邮箱进行真实 OTP 联调，本文不记录邮箱或验证码。
- 本地忽略文件 `.env.local` 只存测试库公开连接键、测试 URL 和新生成的本地 OTP context 签名密钥；未使用 service_role，未记录密钥或会话。
- Access token expiry 3600 → 900 秒，保存后重新加载核实。保留 refresh reuse detection，复用窗口 10 秒；未启用单会话限制。
- 原有 Before User Created 学校准入 Hook 启用；邮箱认证及 Confirm email 启用，匿名登录关闭。
- 原有 OTP 长度 6、有效期 600 秒；注册与登录邮件模板含 Token；自定义 SMTP 已配置。每用户重发间隔 60 秒。上述邮件设置未修改；后续真实收信与验证码验证成功，见下段结果。

## 数据库操作

按仓库顺序，在单事务内补齐下列迁移，并将完整原始 SQL 与版本、名称登记到 `supabase_migrations.schema_migrations`：

1. `202609160001_course_member_relationships.sql`
2. `202609250001_member_context_rpc.sql`
3. `202609260001_rls_initplan_and_fk_indexes.sql`
4. `202610040001_web_push.sql`
5. `202610050001_dashboard_courses_rpc.sql`
6. `202610050002_course_room_rpc.sql`

应用后检查：6 条迁移均登记；`get_member_context(text)` 存在；anon 无执行权，authenticated 有执行权。Auth 用户、members、profiles 行数应用前后均为 7。未逐表比较所有业务数据，未执行推送或清理任务。

## 本次 HTTP 实测

全部请求从本地移动接口执行；学校列表实际访问远程测试库。以下响应均有 no-store，未设置 Cookie。

| 场景 | HTTP / status |
|---|---|
| 学校列表 | 200 / ok，3 所学校 |
| session 无 Bearer | 401 / authentication_required |
| session 伪造 Bearer | 401 / access_token_invalid |
| 仅伪造 Cookie 访问 session | 401 / authentication_required |
| 匿名读取 profile、退出 | 均 401 / authentication_required |
| 非法邮箱、学校域名不匹配、未知学校 | 均 400 / invalid_email |
| 伪造 OTP context | 400 / invalid_or_expired_context |
| PATCH schools | 405 / method_not_allowed |
| 超过 16 KiB 的请求体 | 413 / request_too_large |

刷新异常检查：初测 3 个合成无效 refreshToken 均返回 503 / temporarily_unavailable。直接测试 Auth 返回 400 / validation_failed（Refresh token is not valid），未进入现有 session_invalid 分类。已将该明确拒绝结果加入刷新专属的失效分类，增加回归，并通过本地接口连接测试 Auth 复测：401 / session_invalid。原有未知服务端错误仍返回 503。

## 真实邮箱与单会话联调

用户在本地密码输入框提交验证码后，一次性工具执行 11 项检查，全部通过，最终状态 complete：

| 场景 | HTTP / status |
|---|---|
| 真实邮件验证码请求 | 200 / code_sent |
| 用户收信后验证码登录 | 200 / signed_in |
| Bearer 会话与成员读取 | 200 / ok，身份与登录结果一致 |
| 本人资料读取 | 200 / ok |
| 空昵称保存被拒绝 | 400 / invalid |
| 使用原有字段值保存资料 | 200 / saved |
| 重新读取资料 | 200 / ok，完整资料与原值一致 |
| 刷新请求带伪造过期 Bearer | 200 / refreshed，返回整对有效凭据 |
| 使用刷新后的 accessToken 读取成员 | 200 / ok |
| 当前设备退出 | 200 / signed_out |
| 使用退出后的 refreshToken 刷新 | 401 / session_invalid |

每项同时检查 no-store 且不设置 Cookie。会话与验证码只存临时进程内存；完成后清空会话与 context，结果 JSON 不含邮箱、资料值、用户 ID 或凭据。资料保存沿用原有值，没有修改昵称、专业、毕业年份或头像；没有覆盖其他用户资料。没有等待 accessToken 自然过期，也没有验证两个独立会话，因此本轮不能证明过期时序和双设备隔离。

## 待完成与边界

- 单会话真实认证、本人资料读写、正常刷新与退出后凭据失效已通过。测试账号已有资料，首次资料补全及原生端首次准入尚未验收。
- 后续验证：两设备仅退出当前设备、自然到期、临时故障与成员拒绝区分。双设备需要两个独立登录会话与相应验证码，不把本轮单会话结果视为通过。
- 伙伴 review 提到的首次 verify 后成员读取失败分类，仍按 Ticket 1 单独未完成项跟踪；此次没有修改共享网页登录服务。
- iOS 原生页面、Keychain、本地数据库与离线状态尚未开发，此记录不构成 App 上架验收。
- 本次修复后实际检查：定向 18 项通过；全量 `npm test` 101 文件／673 项通过 → `npm run build` → `npm run lint` → `npm run typecheck` 依次通过。没有把旧结果计入此次验证。
