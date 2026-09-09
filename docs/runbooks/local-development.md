# Runbook：本地开发

> 相关：[新建 Supabase 项目](./new-supabase-project.md) · [部署](./deploy.md)

```bash
npm install
cp .env.example .env.local   # 填 Supabase URL、publishable key、OTP 签名密钥
npm run dev
```

`EMAIL_OTP_CONTEXT_SECRET` 是本实例内部用的 HMAC 密钥，任意 32 位以上随机串即可，**不需要与任何人保持一致**：

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

**验证命令的顺序很重要：**

```bash
npm test && npm run build && npm run lint && npm run typecheck
```

`build` 必须排在 `typecheck` 前面。`typecheck` 依赖 Next 在构建时生成到 `.next/types` 的全局类型，**在新克隆的仓库上直接跑会报 `Cannot find name 'LayoutProps'`**——这不是真错误。配 CI 时同样要注意这个顺序。
