# 前端路由与大厅页交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

> 更新日期：2026-09-10
>
> 配套阅读：[`email-otp-auth.md`](./email-otp-auth.md)（认证模块）、[`environment-and-deployment.md`](./environment-and-deployment.md)（环境与部署）

> ⚠️ **2026-09-10 现状**：第三节原本描述的是 #13 之前的占位大厅，已按合并后的状态改写。第一、二、五节（路由分流、登录落点、Next.js 版本差异）仍然有效。

## 背景

在此之前网站只有一个页面：`/` 上放着登录表单。验证码校验成功后**没有任何跳转**，只是原地显示一句"登录成功"，看起来很像坏了。

同时有个隐患：`src/proxy.ts` 会把未登录用户送去 `/login`，但**那个路由根本不存在**——只要出现第一个受保护页面，跳过去就是 404。

这一轮补上了落点，并顺手修掉了那个隐患。

---

## 一、路由结构

| 路由 | 作用 | 是否需要登录 |
|---|---|---|
| `/` | **只做分流**，本身不渲染任何界面 | 公开 |
| `/login` | 登录表单（从 `/` 迁过来） | 公开 |
| `/dashboard` | 大厅 | **需要** |

分流规则：

```
/            已登录 → /dashboard      未登录 → /login
/login       已登录 → /dashboard（或 next 参数指定的页面）
/dashboard   未登录 → /login?next=/dashboard   ← 由 proxy 拦截
```

### 不要把界面放回 `/`

`src/proxy.ts` 把未登录用户往 `/login` 送。如果 `/` 上也放一份登录表单，同一个界面会出现在两个地址上，用户和搜索引擎都会困惑。`/` 保持只做 `redirect()`。

### `PUBLIC_PATHS` 决定哪些路由不需要登录

在 `src/features/auth/protected-access.ts`。新增公开页面（比如"关于我们"）要往那里加，否则 proxy 会把访客弹去登录页。**新增受保护页面则什么都不用做**——默认就是受保护的。

---

## 二、登录后的跳转是怎么实现的（重要）

[`email-otp-auth.md`](./email-otp-auth.md) 里有一条明确的架构约定：

> 认证模块只返回登录结果，不决定登录后的页面。

这一轮**没有破坏这条约定**。跳转是这样实现的：

1. 用户在 `/login` 输入验证码，Server Action 校验通过并写入会话 Cookie。
2. Server Action 完成后 Next.js 重新渲染 `/login` 这个 Server Component。
3. 此时 `getCurrentMember()` 已经能读到有效会话，**页面自己** `redirect()` 进大厅。

也就是说落点由**页面**决定，认证模块依旧只返回 `{ status, message }`。退出登录同理——`src/features/dashboard/actions.ts` 里包了一层，先调认证模块的 `signOutCurrentDeviceAction()`，再由这层决定回到 `/login`。

**接手时请维持这个方向。** 不要为了省事把 `redirect()` 塞进 `src/features/auth/actions.ts`——那会让认证模块和具体页面结构绑死，将来做"登录后回到原来那一页"之类的需求会很难拆。

### 开放重定向已经挡住

`/login?next=` 只接受站内相对路径。`//evil.com`、`https://evil.com` 这类会被 `safeNextPath()` 丢弃并退回 `/dashboard`。加新的跳转参数时照抄这个校验。

---

## 三、大厅与课程页（已被 #13 取代）

这里原先记录的是占位大厅：课程列表写死在 `src/features/dashboard/placeholder-data.ts`，页面顶部挂着"这是占位界面"的黄色提示。课程流程（#13）合并后，占位数据与占位课程卡已删除，大厅改为读取真实的选课与课程会话，并新增了课程会话页 `/courses/[courseId]`。

当前实现见 [统一会话核心](./unified-conversation-core.md) 与 [课程目录并入主干](./course-catalog-integration.md)。

仍然成立的一条约束：**`src/features/dashboard/components/` 下的组件应保持纯展示**，不查数据库、不发请求，数据由 Server Component 查好后经 props 传入。这是协作者改 UI 时碰不到数据层的前提。

---

## 五、这一轮踩到的 Next.js 版本差异

`AGENTS.md` 要求写代码前读 `node_modules/next/dist/docs/`，这一轮确实靠它避开了一个坑：

**`searchParams` 和 `params` 在这个版本里是 Promise，必须 `await`。**

```tsx
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
}
```

凭训练数据里的旧写法（直接当对象用）会直接类型报错。别跳过读文档这一步。

另外 `redirect()` 靠抛异常实现，**必须写在 `try/catch` 之外**，否则会被自己的 catch 吞掉。

---

## 六、文件清单

| 文件 | 归属 |
|---|---|
| `src/app/page.tsx` | 分流，不含界面 |
| `src/app/login/page.tsx` | 登录页 |
| `src/app/dashboard/page.tsx` | 大厅，取数据并传 props |
| `src/features/auth/session.ts` | `getCurrentMember()`，页面用的会话读取器。**主开发者职责区** |
| `src/features/dashboard/actions.ts` | 退出登录并决定落点 |
| `src/features/dashboard/components/*` | 纯展示组件，**协作者主场** |

`src/features/auth/session.ts` 在 `.github/CODEOWNERS` 的保护范围内（`/src/features/auth/`）。

### 大厅页自己也鉴权一次

`src/proxy.ts` 已经挡过一遍，但 `dashboard/page.tsx` 里仍然重新调了一次 `getCurrentMember()`。这是刻意的冗余——proxy 的注释里也写着"不能只信 Proxy"。新增受保护页面时请照做。

---

## 七、待办

- **课程库待导入并物化**，见 [录入课程 runbook](../runbooks/seed-courses.md)。课程搜索、加入与课程会话已由 #13 实现。
- **登录后回到原本想去的页面**：`next` 参数的链路已经通了（proxy 写入、`/login` 读取并校验），但目前只有 `/dashboard` 一个受保护页面，实际还看不出效果。
- **大厅的移动端适配**没有专门验证过，只用了响应式类。
- **`/dashboard` 之外还没有任何业务页面**，课程详情、群聊界面都还不存在。
