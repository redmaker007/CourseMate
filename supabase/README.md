# Supabase

数据库 schema、RLS 策略和 migration 都放这里。**这个目录只有主开发者能改**（见根目录 `CODEOWNERS`）。

## 目录

- `migrations/` — 按时间戳排序的 SQL migration，只增不改。已经推到 `main` 的 migration 不要编辑，写一个新的去修正。

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

## Auth Hook 配置

应用 migration 后，在 Supabase Dashboard 的 Authentication Hooks 中，把
`public.hook_restrict_user_to_enabled_school` 配置为 **Before User Created** Hook。
该 Hook 是公开 Auth 端点的数据库防线；只创建函数但不在项目中启用，不能算完成真实集成验收。
