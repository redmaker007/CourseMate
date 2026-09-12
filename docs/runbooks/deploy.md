# Runbook：部署

> 相关：[新建 Supabase 项目](./new-supabase-project.md) · [本地开发](./local-development.md)

## `NEXT_PUBLIC_*` 变量绝对不能标成 Sensitive

Vercel 的 Sensitive（Secret）类型变量在**构建阶段读不到**，而 Next.js 会在构建时把 `NEXT_PUBLIC_*` 内联进产物。两者相撞的结果是变量被编译成 `undefined`，**部署后全站 500**，运行时再怎么配也救不回来。

这两个值本来就是公开的（会打包进浏览器），标 Config 即可：

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "<url>" --no-sensitive --force
```

`EMAIL_OTP_CONTEXT_SECRET` 是服务端专用、运行时读取，保持 Secret 没问题。它**必须存在**，缺了会让发码 Server Action 直接崩。

## Git 自动部署与数据库发布顺序

2026-09-12 已通过 Vercel 项目 API 核实：项目连接了 GitHub，生产分支为 `main`。旧手册的“未连接”记录已经过时。合并通常会自动生产部署。

PR #24 引入尚未在生产核实的数据库迁移，因此仓库 `vercel.json` 临时设置 `git.deploymentEnabled.main = false`。合并代码时保留现有生产版本；其他分支的预览部署保持启用。此配置只限制 Git 触发，不能阻止人工执行生产部署。配置语义见 [Vercel 官方文档](https://vercel.com/docs/project-configuration/git-configuration)。

发布这批功能必须按顺序完成：

1. 记录当前生产 deployment ID 与提交，确认数据库具有可用的恢复备份。
2. 按 [数据库手册](./new-supabase-project.md)及[第一阶段联调](../handoffs/phase-one-integration.md)只读核对真实表、函数、策略、触发器、publication 与 migration 历史。SQL Editor 曾手工执行迁移，不能只看历史表，也不能直接重跑旧迁移。
3. 根据核对结果制定并确认历史修复与缺失迁移方案。核对 `db push --dry-run` 后应用缺失迁移，包括管理迁移和好友、私聊、举报、清理、拉黑方向、可靠发送的完整依赖链。
4. 从已迁移的生产数据库重新生成 `src/types/database.ts`，比较本地完整链生成的类型。验证全部测试、构建、lint、类型检查；在指向已准备数据库的预览环境完成业务冒烟。
5. 确认可发布后，单独提交解除 `main` 自动部署暂停的配置，或从明确验证过的提交手动 `npx vercel deploy --prod`。手动发布不自动解除后续 Git 部署暂停。
6. 检查生产域名绑定的新版本，验收登录/onboarding、管理、课程群聊、好友、私聊发送与重试、拉黑、举报及 Realtime。失败时先恢复旧前端 deployment；不要通过删除数据或盲目反向迁移回滚数据库。

私聊物理清理保持默认 dry-run；生产调度与真实删除须按[清理交接](../handoffs/direct-message-cleanup.md)另行验证和启用。不要为了功能上线顺便打开删除任务。

## 旧部署 URL 会永远停在旧构建

每个 `vercel deploy` 生成一个独立不变的 URL。改完环境变量必须**重新部署**，旧链接不会自动更新。排查时先确认自己打开的是最新那个部署。

## 公开的是生产部署，预览部署仍受保护

`vercel deploy` 发的是**预览**部署，受 Vercel Authentication 保护，陌生人会被 302 送去 Vercel 登录页。`vercel deploy --prod` 发的是**生产**部署，在 Hobby 方案下不受该保护，且绑定固定网址 <https://course-mate-three.vercel.app>。

这个分工是刻意保留的，不要去关掉 Deployment Protection 开关：试验性改动先发预览版自己看，确认无误再 `--prod`，公开网址不受影响。

公开后任何人都能触发发信，但实际风险有限——Auth Hook 会拒绝 `wisc.edu` / `umich.edu` 之外的所有域名，只有这两所学校的真实邮箱能走到发信那一步。额度上限是 Brevo 每天 300 封，Supabase 侧每小时限流兜底。
