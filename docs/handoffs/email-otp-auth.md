# 学校邮箱 OTP 认证模块交接

> 更新日期：2026-09-07
>
> 工作分支：`feature/email-otp-auth`
>
> 父级需求：[GitHub Issue #1](https://github.com/redmaker007/CourseMate/issues/1)
>
> 当前验收入口：[GitHub Issue #7](https://github.com/redmaker007/CourseMate/issues/7)

## 当前结论

学校邮箱 OTP 认证的本地代码、数据库迁移、邮件配置和主要自动化测试已经完成。专用托管 Supabase 测试项目已经能够向真实 `@wisc.edu` 邮箱发送六位验证码，并完成登录与 Member Account 绑定检查。

整个认证系统尚未完成最终验收。Issue #7 仍有真实数据库安全、验证码边界、持久会话和多设备退出等人工验收项。完成这些项目以前，只能声明“本地实现完成，真实发码与基本登录已跑通”。

## 阅读顺序

接手认证模块时依次阅读：

1. 本文档，确认当前进度和剩余工作。
2. [`docs/specs/auth-email-otp.md`](../specs/auth-email-otp.md)，确认完整产品和技术要求。
3. [`CONTEXT.md`](../../CONTEXT.md) 与 [`docs/adr/0001-separate-member-account-from-profile.md`](../adr/0001-separate-member-account-from-profile.md)，使用统一领域语言和数据模型。
4. [Issue #7](https://github.com/redmaker007/CourseMate/issues/7) 的最新正文与评论，以 GitHub 勾选状态作为真实集成验收进度。

读完并核对 Issue #7 后再继续测试或修改代码。

## 已交付

### 学校资格与发码

- 数据库是开放学校和精确邮箱域名的唯一规则来源。
- 当前测试配置为 University of Wisconsin–Madison 的精确 `wisc.edu` 域名。
- 当前配置不代表正式产品试点学校永久确定；未来学校通过数据库配置增加或更换。
- 任意 `.edu`、无关域名和未配置的 `cs.wisc.edu` 子域名不会被自动接受。
- Server Action 在调用 Supabase Auth 前完成服务端校验。
- Supabase Before User Created Hook 从数据库规则再次校验，防止外部直接调用公开 Auth 端点绕过应用。

### OTP 验证与成员绑定

- 用户只输入六位 ASCII 数字验证码，不使用密码或 Magic Link 界面。
- Supabase Auth 负责 OTP 生成、十分钟过期、验证和一次性使用；CourseMate 不保存 OTP 明文。
- 发码时的学校和规范化邮箱保存在短时 HMAC 签名上下文中，客户端修改后会被拒绝。
- Auth 邮箱首次确认时，数据库触发器原子、幂等地创建 `member_accounts` 学校绑定。
- Member Account 独立于可选 Profile；缺少昵称等资料不会阻止登录。
- 只有有效 Supabase 用户和一致的 Member Account 绑定同时存在时，才算有效 CourseMate 会话。

### 会话与退出

- Supabase SSR Cookie 在服务端读取和刷新。
- Proxy 与认证服务复用同一个 Member Session 定义。
- 只有 Auth 而缺少可信绑定的状态不能被代码判定为已登录。
- 退出使用 Supabase `local` scope，只撤销当前设备；无会话时重复退出仍返回成功。
- 认证模块只返回登录结果，不决定登录后的页面。当前验证成功后停留在原页面是预期行为，不是故障。

### 邮件与 SMTP

- Supabase Auth 配置为六位 OTP、十分钟有效期和同邮箱六十秒重发间隔。
- 邮件模板为简短中英双语，不包含 Magic Link。
- SMTP 供应商只通过 Supabase Custom SMTP/环境配置接入，业务代码不依赖具体供应商。
- 当前免费 SMTP 仅用于开发验收，未来可直接替换为正式供应商配置。

### 已修复的安全问题

- [Issue #8](https://github.com/redmaker007/CourseMate/issues/8) 已修复 React 重复 key 将可解码邮箱验证上下文写入开发日志的问题。
- 每次成功发码现在生成随机、非敏感的 `flowId`，用于安全地重置验证码表单和六十秒倒计时。
- 发码日志不再记录客户端提供的原始 `schoolId`；成功时只记录服务层确认的学校 ID，其余为固定的 `unresolved`。
- 回归测试覆盖 React 日志泄露、恶意日志输入和重发后的状态重置。

## 托管环境已确认

专用 Supabase 测试项目 `CourseMate-Auth-Test` 已完成以下验证：

- 两项正式 migration 已应用，远端与本地迁移版本一致。
- 外部请求直接调用 Supabase Auth 时，非开放学校精确域名被 Before User Created Hook 以 HTTP 403 拒绝。
- Custom SMTP 已接通，真实 `@wisc.edu` 邮箱收到六位 OTP。
- 输入真实 OTP 后应用返回“邮箱验证成功，已登录”。该结果要求 Auth 会话和可读取的一致 Member Account 绑定同时存在。

这些记录不包含真实邮箱、验证码、Supabase key 或 SMTP 凭据。

## Issue #7 剩余工作

以下项目仍需要在专用托管环境中实际执行并留下脱敏证据：

- [ ] 验证真实 Auth 事务原子且幂等地创建 Member Account，并验证绑定异常会让事务失败。
- [ ] 以成员身份验证 RLS 阻止新增、修改和删除绑定，并验证数据库拒绝修改 Auth 登录邮箱。
- [ ] 验证错误、过期和已使用 OTP 的统一失败行为。
- [ ] 验证重发后的最新 OTP 和真实六十秒冷却行为。
- [ ] 关闭并重新打开浏览器，验证 Cookie 会话保持。
- [ ] 构造只有 Auth、没有 Member Account 绑定的受控测试状态，确认其不能访问受保护页面。
- [ ] 使用两个独立浏览器环境登录同一账号，确认一个环境退出不影响另一个环境。
- [ ] 形成可重复执行的托管环境人工验收记录，且不包含凭据或个人信息。

每完成一项，先记录可复现步骤与脱敏结果，再更新 Issue #7。所有项目完成前保持 Issue #7 开启。

## 尚未实现或刻意延后

以下内容属于已确认的后续范围，不应被误报为当前回归：

- CAPTCHA、应用自管每日发送上限、额外 IP/邮箱限流、错误次数锁定和异常监控。
- 正式发信域名、正式 SMTP 供应商和生产配额。
- 学校运营管理界面，以及学校停用后既有成员的处理策略。
- 更换邮箱、账号转移、转校、别名合并和未验证 Auth 记录清理。
- 正式业务首页及登录成功跳转。
- Profile、课程、群聊及其他业务模块权限。

邮箱验证只能证明用户当时能够访问该学校邮箱，不能证明用户当前在读或其真实身份。产品和文案应使用“已验证学校邮箱”，避免表述为“已认证学生”。

## 当前风险状态

- 截至本交接文档更新时，`npm audit` 报告 0 个已知依赖漏洞。
- Issue #8 的两项已知日志隐私缺陷已经修复并通过双轴 review。
- 最大剩余风险是 Issue #7 的托管安全边界尚未全部经过真实环境验收，而不是已确认存在新的可利用漏洞。
- 免费 SMTP 和个人验证 Sender 适合功能测试，不应直接视为正式生产发信方案。
- 当前只有 `wisc.edu` 测试数据；数据模型支持新增学校，但每个新域名仍需单独配置和验收。

## 关键文件

- `src/features/auth/email-otp-service.ts`：请求和验证 OTP 的稳定业务接口。
- `src/features/auth/actions.ts`：网站 Server Actions 与脱敏日志。
- `src/features/auth/components/request-email-code-form.tsx`：可替换的最小测试界面。
- `src/features/auth/member-session.ts`：有效 Member Session 的统一定义。
- `src/proxy.ts`：受保护路径与服务端会话刷新。
- `supabase/migrations/202609050001_email_otp_request.sql`：学校域名模型与创建用户前置 Hook。
- `supabase/migrations/202609050002_member_account_binding.sql`：成员绑定、RLS 和邮箱不可变约束。
- `supabase/config.toml` 与 `supabase/templates/email-otp.html`：本地 Auth/SMTP/OTP 模板配置。
- `docs/specs/auth-email-otp.md`：完整正式规格。

## 验证命令

在仓库根目录运行：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
```

最近一次完整结果：14 个测试文件、98 项测试通过；类型检查、Lint 和生产构建通过；依赖审计为 0 个漏洞。

## 分支与提交状态

- 功能分支：`feature/email-otp-auth`
- Issue #2–#6：已完成并关闭。
- Issue #8：已完成并关闭，修复提交为 `8d91913`。
- Issue #7：保持开启，完成三项、剩余六项。
- 当前功能分支尚未合并到 `main`。

继续开发时在现有功能分支提交，并通过 PR review 后再合并到 `main`。

## 秘密与本地文件边界

以下内容保留在本地或托管平台设置中：

- `.env.local`
- Supabase secret/service role key
- SMTP Login、SMTP Key 和 Sender 验证信息
- 真实邮箱、验证码和浏览器会话
- 个人 `HANDOFF.md`、`.agents/` 技能及个人过程日志

提交时只暂存明确的项目文件。环境变量名称和无秘密的 `.env.example` 可以提交，真实值不得进入 Git、Issue、测试输出或交接记录。
