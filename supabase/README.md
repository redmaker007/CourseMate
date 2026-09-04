# Supabase

数据库 schema、RLS 策略和 migration 都放这里。**这个目录只有主开发者能改**（见根目录 `CODEOWNERS`）。

## 目录

- `migrations/` — 按时间戳排序的 SQL migration，只增不改。已经推到 `main` 的 migration 不要编辑，写一个新的去修正。

## 铁律

1. **每张用户可写的表都必须开 RLS**，并且写完策略后要实际验证过。`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` 只是第一步——开了 RLS 但没写策略等于全表拒绝，写错策略等于全表放开。
2. **`service_role` key 不进代码库。** 它绕过所有 RLS。
3. 学校邮箱域名限制要在服务端强制一次，前端的 `src/lib/auth/school-domains.ts` 只是给用户即时提示，绕得过去。

## 还没做的事

- [ ] schema 设计（users / courses / course_members / groups / group_members / messages）
- [ ] 每张表的 RLS 策略
- [ ] 加入课程后自动建群/入群的 trigger 或 RPC
- [ ] 邮箱域名的服务端强制
- [ ] 跑 `npx supabase gen types typescript` 生成 `src/types/database.ts`

## 本地开发

```bash
npx supabase init
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```
