# Runbook：部署

> 相关：[新建 Supabase 项目](./new-supabase-project.md) · [本地开发](./local-development.md)

## `NEXT_PUBLIC_*` 变量绝对不能标成 Sensitive

Vercel 的 Sensitive（Secret）类型变量在**构建阶段读不到**，而 Next.js 会在构建时把 `NEXT_PUBLIC_*` 内联进产物。两者相撞的结果是变量被编译成 `undefined`，**部署后全站 500**，运行时再怎么配也救不回来。

这两个值本来就是公开的（会打包进浏览器），标 Config 即可：

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "<url>" --no-sensitive --force
```

`EMAIL_OTP_CONTEXT_SECRET` 是服务端专用、运行时读取，保持 Secret 没问题。它**必须存在**，缺了会让发码 Server Action 直接崩。

## `git push` 不会上线 ← 最容易误解的一点

Vercel **没有连接 GitHub 仓库**。推送只是把代码送到 GitHub，Vercel 对此一无所知。线上版本只有在有人手动执行下面这句时才会更新：

```bash
npx vercel deploy --prod
```

所以「合并了修复」和「用户能用上修复」是两件独立的事。改完代码只 push 不部署，线上会一直停在旧版本，而且没有任何报错提示你。

要改成 push 自动部署，需要在 Vercel 后台把项目连上 GitHub 仓库。目前刻意没连——好处是可以先发预览版自己验，坏处就是这条容易忘。

## 旧部署 URL 会永远停在旧构建

每个 `vercel deploy` 生成一个独立不变的 URL。改完环境变量必须**重新部署**，旧链接不会自动更新。排查时先确认自己打开的是最新那个部署。

## 公开的是生产部署，预览部署仍受保护

`vercel deploy` 发的是**预览**部署，受 Vercel Authentication 保护，陌生人会被 302 送去 Vercel 登录页。`vercel deploy --prod` 发的是**生产**部署，在 Hobby 方案下不受该保护，且绑定固定网址 <https://course-mate-three.vercel.app>。

这个分工是刻意保留的，不要去关掉 Deployment Protection 开关：试验性改动先发预览版自己看，确认无误再 `--prod`，公开网址不受影响。

公开后任何人都能触发发信，但实际风险有限——Auth Hook 会拒绝 `wisc.edu` / `umich.edu` 之外的所有域名，只有这两所学校的真实邮箱能走到发信那一步。额度上限是 Brevo 每天 300 封，Supabase 侧每小时限流兜底。
