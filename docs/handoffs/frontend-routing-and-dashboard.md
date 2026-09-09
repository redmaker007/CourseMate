# 前端路由与大厅页交接

> 更新日期：2026-09-08
>
> 配套阅读：[`email-otp-auth.md`](./email-otp-auth.md)（认证模块）、[`environment-and-deployment.md`](./environment-and-deployment.md)（环境与部署）

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

## 三、大厅里什么是真的、什么是假的

### 真实数据

- **学校名**：按会话里的 `schoolId` 从 `schools` 表查中文名，查不到就退回学校 ID（展示信息不该拦住整个页面）。
- **邮箱**：来自 `supabase.auth.getUser()`。

这两项顺带起到验证作用——能正确显示，就说明 Member Account 绑定确实生效了。

### 占位数据

课程列表、学习搭子、笔记共享全部是写死的。**全部假数据集中在 `src/features/dashboard/placeholder-data.ts` 一个文件里。**

页面顶部有一条醒目的黄色提示写明"这是占位界面，课程与群聊尚未接入数据库"。**这不是遗漏，是刻意的**——避免后来者把占位数据当成故障去排查。接入真实数据时记得连这条提示一起删掉。

### 为什么是假数据

`courses` / `course_members` / `groups` / `group_members` / `messages` 这些表**已经在线上数据库里了**，`schools` 表冲突也已解决。占位数据还在，是因为两件事：**课程库一门课都没录**，而且**还没有任何页面查过真实的 `courses` 表**。进度见 [`environment-and-deployment.md`](./environment-and-deployment.md)，录入方式见 [录入课程 runbook](../runbooks/seed-courses.md)。

---

## 四、接真实数据时怎么改

设计上已经把这一步的成本压到最低：

1. 删掉 `placeholder-data.ts`。
2. 在 `src/app/dashboard/page.tsx`（Server Component）里查询真实课程。
3. 把结果按**同样的 props 形状**传给现有组件。

**组件一行都不用改。** 因为 `src/features/dashboard/components/` 下的组件全部是纯展示的——不查数据库、不发请求、不读环境变量，只接收 props。

这也是所有权边界的落地方式：协作者改 UI 时碰不到数据层和权限代码。**新增组件请维持这条约束**，需要数据就往上层要，不要在组件里直接 `createClient()`。

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
| `src/features/dashboard/placeholder-data.ts` | 假数据，接真实数据时删除 |
| `src/features/dashboard/components/*` | 纯展示组件，**协作者主场** |

`src/features/auth/session.ts` 在 `.github/CODEOWNERS` 的保护范围内（`/src/features/auth/`）。

### 大厅页自己也鉴权一次

`src/proxy.ts` 已经挡过一遍，但 `dashboard/page.tsx` 里仍然重新调了一次 `getCurrentMember()`。这是刻意的冗余——proxy 的注释里也写着"不能只信 Proxy"。新增受保护页面时请照做。

---

## 七、待办

- **课程与群聊接真实数据**。表已在线上，缺的是往 `course_catalog` 灌数据，以及写课程搜索/创建/加入这几个页面。
- **登录后回到原本想去的页面**：`next` 参数的链路已经通了（proxy 写入、`/login` 读取并校验），但目前只有 `/dashboard` 一个受保护页面，实际还看不出效果。
- **大厅的移动端适配**没有专门验证过，只用了响应式类。
- **`/dashboard` 之外还没有任何业务页面**，课程详情、群聊界面都还不存在。
