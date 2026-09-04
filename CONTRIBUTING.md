# 协作约定

2 人团队，分工按「碰不碰得到权限」划线。

## 谁改什么

**主开发者独占**（`.github/CODEOWNERS` 里列的路径）：

- `supabase/` — schema、migration、RLS 策略
- `src/lib/supabase/` — Supabase 客户端与 session 处理
- `src/lib/auth/`、`src/lib/env.ts`、`src/proxy.ts` — 认证与路由保护
- `src/types/database.ts` — 生成的类型，不手写

**协作者主场**：

- `src/components/ui/` — 无状态展示组件，不直接查数据库
- `src/features/<模块>/components/` — 各功能模块的 UI
- `src/app/**/page.tsx` 的布局与样式

界线是：**UI 组件不自己发数据请求**。数据由 Server Component 或 feature 层的函数取好，通过 props 传给组件。这样改 UI 永远碰不到权限代码。

## 目录约定

```
src/
  app/            路由（App Router）
  components/ui/  通用展示组件
  features/       按功能模块分：auth / profile / courses / groups / chat
  lib/            跨模块的基础设施
  types/          类型定义
supabase/         schema 与 RLS
```

每个 feature 模块内部：

```
features/courses/
  components/   该模块的 UI
  actions.ts    Server Actions（写操作）
  queries.ts    数据读取
```

## 分支与 PR

- `main` 受保护，禁止直接 push。
- 分支命名：`feature/功能名` 或 `fix/问题描述`，例如 `feature/course-search`、`fix/login-redirect`。
- 所有改动走 PR，由主开发者 review 后合入。
- PR 描述里写清楚**改了什么**和**怎么验证的**。

## 提交前

```bash
npm run lint
npm run build
```

两个都过了再开 PR。

## 安全底线

- `.env.local` 永远不提交。
- `service_role` key 不进代码库、不给协作者、不加 `NEXT_PUBLIC_` 前缀。
- 新建任何用户可写的表，同一个 PR 里必须带上 RLS 策略。
- 前端的校验（比如学校邮箱域名）只是提示，服务端必须再拦一次。
