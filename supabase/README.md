# Supabase

数据库 schema、RLS 策略和 migration 都放这里。**这个目录只有主开发者能改**（见根目录 `CODEOWNERS`）。

## 目录

- `migrations/` — 按时间戳排序的 SQL migration，只增不改。已经推到 `main` 的 migration 不要编辑，写一个新的去修正。
- `config.toml` — 可部署的 Supabase Auth 配置，包括 OTP 时效、重发间隔、SMTP 适配层和邮件模板入口。
- `templates/email-otp.html` — 只包含验证码的中英双语登录邮件，不包含 Magic Link。

## 铁律

1. **每张用户可写的表都必须开 RLS**，并且写完策略后要实际验证过。`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` 只是第一步——开了 RLS 但没写策略等于全表拒绝，写错策略等于全表放开。
2. **`service_role` key 不进代码库。** 它绕过所有 RLS。
3. 学校邮箱域名限制必须同时由网站服务端和 Supabase Before User Created Hook 执行，两者都读取数据库中的同一份精确域名规则。

## 还没做的事

- [ ] 其余 schema 设计（courses / course_members / groups / group_members / messages）
- [ ] 每张表的 RLS 策略
- [ ] 加入课程后自动建群/入群的 trigger 或 RPC
- [x] 学校邮箱精确域名的服务端校验与 Before User Created Hook 函数
- [ ] 跑 `npx supabase gen types typescript` 生成 `src/types/database.ts`

## 本地开发

```bash
npx supabase init
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

无需云端凭据即可先在嵌入式 PostgreSQL 中执行 migration 并验证 RLS：

```bash
npm test -- supabase/migrations/email-otp-request.test.ts
```

## 邮箱 OTP 与 SMTP

`config.toml` 要求用户完成邮箱确认，将验证码固定为 6 位、10 分钟有效，并把同一邮箱再次发送的最短间隔设为 60 秒。这样新用户只有在验证 OTP 后才会触发成员账号绑定。页面倒计时也使用相同的 60 秒规则。

SMTP 主机、用户、密码、发件邮箱和发件人名称全部通过 `SUPABASE_AUTH_SMTP_*` 环境变量注入；仓库只提交 `.env.example` 中的占位值。切换邮件服务商时修改环境变量（必要时修改 SMTP 端口配置），不需要改验证码请求、验证或成员绑定代码。

本地 `config.toml` 不会仅凭 Git push 自动改变托管的 Supabase 项目。部署负责人需要先在当前终端安全地设置 SMTP 环境变量，再执行：

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase config push
```

也可以在 Supabase Dashboard 中配置同样的 Custom SMTP、邮件模板、10 分钟 OTP 有效期和 60 秒发送间隔。真实密钥只放本机或部署平台的 Secret 管理中，不写入 Git、日志或工单。

## Auth Hook 配置

应用 migration 后，在 Supabase Dashboard 的 Authentication Hooks 中，把
`public.hook_restrict_user_to_enabled_school` 配置为 **Before User Created** Hook。
该 Hook 是公开 Auth 端点的数据库防线；只创建函数但不在项目中启用，不能算完成真实集成验收。
