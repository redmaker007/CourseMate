# CourseMate 项目交接说明

> 这份文档是写给接手这个项目的 AI 助手看的。请在动手写任何代码前完整读完。
> 文档写于 2026-09-03，对应 commit `ff5b596`。

---

## 0. 先读这一段：三件最容易出错的事

如果你只读一段，读这段。这三件事你的训练数据大概率是错的或者不知道：

1. **Next.js 16 把 `middleware.ts` 改名成了 `proxy.ts`**，导出的函数名也从 `middleware` 变成 `proxy`。写成旧名字不会报错，文件会静默地完全不生效。本项目已经用了新名字（`src/proxy.ts`），**不要"帮忙改回" `middleware.ts`**。

2. **`@supabase/ssr` 的 `setAll` 回调现在有第二个参数 `headers`**（一组 no-cache 响应头）。必须把它们写到响应上，否则 CDN/反向代理可能把带着 A 用户 auth cookie 的响应缓存下来发给 B 用户。见 `src/lib/supabase/proxy.ts`。

3. **这个项目里的 Next.js 版本比你的训练数据新。** 仓库根目录的 `AGENTS.md`（由 `CLAUDE.md` 引入）明确要求：写代码前先读 `node_modules/next/dist/docs/` 里的对应文档。请照做，不要凭记忆写 App Router 代码。

---

## 1. 项目是什么

**CourseMate（课友）** —— 非官方的 Piazza 式课程社交平台，解决大课环境下学生互相不认识的问题。

核心场景：按课号找到同课同学 → 自动拉进课程群 → 群里聊天 → （后续）分享笔记、找学习搭子。

首批只在一所学校做单校试点。

---

## 2. 当前进度

**已完成：** 项目骨架 + 数据库 schema 设计。**功能代码一行都还没写。**

### 仓库

`https://github.com/redmaker007/CourseMate.git`

| 分支 | commit | 状态 |
|---|---|---|
| `main` | `0afb905` | 项目骨架，已推送 |
| `feature/db-schema` | `ff5b596` | schema + RLS，已推送，**未合并，PR 未开** |

`feature/db-schema` 是从 `main` 拉出来的，领先 1 个 commit。

### 已经就位的东西

- Next.js 16.3.4（App Router）+ TypeScript + Tailwind CSS v4 脚手架
- Supabase 客户端三件套：
  - `src/lib/supabase/client.ts` — 浏览器端（Client Component 用）
  - `src/lib/supabase/server.ts` — 服务端（Server Component / Server Action / Route Handler 用）
  - `src/lib/supabase/proxy.ts` — proxy 里的 session 刷新
- `src/proxy.ts` — 路由保护，未登录挡在受保护路由外
- `src/lib/env.ts` — 环境变量惰性读取（**故意用 getter**，模块加载时就校验会让没有 `.env.local` 的机器 `next build` 直接崩）
- `src/lib/auth/school-domains.ts` — 学校邮箱域名白名单（前端部分）
- `supabase/migrations/` — 两个 migration，schema + RLS
- `.github/CODEOWNERS`、`CONTRIBUTING.md` — 协作边界

### 完全还没做的

- 注册 / 登录 / 登出 / 密码找回的 UI 和逻辑
- 用户资料页
- 课程搜索 / 创建 / 加入 / 退出
- 群聊界面和 Realtime 订阅
- 任何测试
- `src/types/database.ts` 还是**占位空壳**，需要从真实 Supabase 项目生成

---

## 3. ⚠️ 已知的坑（接手后第一时间处理）

### 3.1 数据库 migration 从未实际执行过

`supabase/migrations/` 下的两个 SQL 文件**只经过人工复查，没有在任何真实 Postgres 上跑过**。写它们的机器上没有 Docker，起不了 `supabase start`。

**请把它们当作未验证代码。** 第一次 `supabase db push` 时要预期可能有语法或逻辑错误，跑完后必须按 `supabase/README.md` 里的清单逐条验证，尤其是这几条越权测试：

- 拿 anon key 直接打 REST 接口，尝试修改别人的 profile → 应被拒
- 往自己没加入的群发消息 → 应被拒
- 手动 `insert` 一条 `group_members` → 应被拒
- 两个不同学校的账号互相查对方课程和资料 → 应查不到
- 同校但无共同课程的两个账号互相查 profile → 应查不到

### 3.2 现在谁都注册不了（这是预期行为，不是 bug）

`schools` 表两条记录的 `enabled` 都是 `false`，而 `enforce_school_email` 触发器要求学校处于 enabled 状态才允许创建 profile。

这是因为**试点学校还没定**（见第 5 节）。定下来之前，注册流程会一直失败。要本地开发调试的话：

```sql
update public.schools set enabled = true where id = 'uw-madison';
```

但**不要把这个改动写进 migration 提交**，除非学校真的定了。

### 3.3 Supabase 项目本身可能还不存在

`.env.example` 是模板，真实的 Supabase 项目是否已创建、`.env.local` 是否已配好，需要跟主开发者确认。没有这个项目，什么都跑不起来。

---

## 4. 代码所有权边界（重要，别越界）

这是个 2 人团队：**主开发者**（GitHub `@redmaker007`，编程能力较强）+ **1 名轻度 vibe coding 协作者**。

分工按"碰不碰得到权限"划线，`.github/CODEOWNERS` 已经把敏感路径锁定：

**主开发者独占 —— 你在改这些路径前必须先确认是在为谁工作：**

```
supabase/                 schema、migration、RLS 策略
src/lib/supabase/         Supabase 客户端与 session 处理
src/lib/auth/             认证与学校邮箱白名单
src/lib/env.ts            环境变量
src/proxy.ts              路由保护
src/types/database.ts     生成的类型，不要手写
next.config.ts, package.json, .github/
```

**协作者主场：**

```
src/components/ui/              无状态展示组件
src/features/<模块>/components/  各功能模块的 UI
src/app/**/page.tsx             布局与样式
```

**核心界线：UI 组件不自己发数据请求。** 数据由 Server Component 或 feature 层的 `queries.ts` 取好，通过 props 传给组件。这样改 UI 的人永远碰不到权限代码。请在写新代码时维持这条界线。

---

## 5. 尚未决定的事 —— 不要替他们拍板

以下几项**至今没有定论**，之前的对话中被明确标记为"待定"。如果任务涉及它们，**请询问用户，不要自己假设一个答案然后往下写**：

| 待定项 | 说明 |
|---|---|
| **首批试点学校** | 可能是威斯康星麦迪逊或密歇根，未定。`schools` 表里两条都 `enabled: false`。 |
| **是否做中国留学生定位** | 产品定位问题，影响 UI 文案和推广策略。 |
| **是否做双语 UI** | 与上一条绑定。决定了要不要引入 `next-intl`。**目前没有安装任何 i18n 库。** |

另外，项目文档和代码注释目前是中文的。保持一致。

---

## 6. 数据库设计要点

Schema 在 `supabase/migrations/20260903000001_init_schema.sql`，RLS 在 `..._20260903000002_rls_policies.sql`。SQL 里有详细中文注释，**请直接读文件**，这里只列几个关键决定和它们的理由，避免你在不知情的情况下改坏：

**表关系：**
```
schools ──< profiles ──< course_members >── courses ──1:1── groups ──< group_members
                                                                  └──< messages
```

1. **`courses` 唯一键是 `(school_id, code_normalized, term)`，`term` 是必需的。**
   没有 term，2026 秋和 2027 春选同一门课的人会被塞进同一个群，而"找到这学期的同课同学"正是产品的核心场景。**不要把 term 改成可选。**

2. **`code_normalized` 是生成列**，把 `'CS 540'` / `'cs540'` / `'CS-540'` 折叠成同一个值。否则同一门课会因为写法不同分裂成好几个群。

3. **`groups` 和 `group_members` 没有任何写策略，权限也被 revoke 了。** 成员资格完全由 `course_members` 上的触发器同步。这保证"谁在群里"恒等于"谁选了这门课"，不会出现不一致状态。**不要为了图方便给它们加 INSERT 策略。**

4. **`messages` 故意不给 UPDATE 策略。** RLS 的 UPDATE 策略管不住"只能改哪一列"，一旦开放，用户就能改自己消息的 `group_id` 把它挪进别的群。P1 做举报审核时，软删除要走 service_role 或一个受限的 `SECURITY DEFINER` 函数。

5. **`is_course_member` / `is_group_member` 等辅助函数用 `SECURITY DEFINER`**，是为了打断 RLS 递归——在 `group_members` 的策略里查 `group_members` 会导致 Postgres 无限递归报错。代价是必须配 `set search_path = ''`，**这个不能省，省了 SECURITY DEFINER 本身就是提权漏洞。**

6. **`created_by` / `user_id` / `sender_id` 都有 `default auth.uid()`**，配合 RLS 的 `with check`，客户端 insert 时不用手填。

---

## 7. 安全底线（不可协商）

1. **每张用户可写的表都必须开 RLS**，且新建表的 PR 里必须同时包含它的 RLS 策略。没有策略 = 全表拒绝；策略写错 = 全表放开。
2. **`service_role` key 绝不进代码库**，绝不加 `NEXT_PUBLIC_` 前缀，绝不给协作者。它绕过所有 RLS。
3. **`.env.local` 永不提交**（`.gitignore` 已配好，`.env.example` 是白名单例外）。
4. **前端校验只是提示，服务端必须再拦一次。** `src/lib/auth/school-domains.ts` 的域名检查绕得过去——任何人都能直接打 Supabase Auth 接口。真正拦得住的是数据库里的 `enforce_school_email` 触发器。
5. **服务端取用户一律用 `supabase.auth.getUser()`，不要用 `getSession()`。** 后者只读 cookie 不校验 JWT，服务端信任它等于信任伪造数据。

---

## 8. 开发工作流

```bash
npm install
cp .env.example .env.local   # 填入 Supabase URL 和 anon key
npm run dev
```

提交前两个都要过：

```bash
npm run lint
npm run build
```

**分支与 PR：**
- `main` 应受保护、禁止直接 push（**注意：GitHub 上的分支保护规则和 Code Owners review 可能还没开启，CODEOWNERS 文件本身不会自动生效，需要在仓库设置里手动配置**）
- 分支命名：`feature/功能名` 或 `fix/问题描述`
- 所有改动走 PR，由主开发者 review 后合入
- PR 描述写清楚改了什么、怎么验证的

**注意：`npx tsc --noEmit` 单独跑会报 `Cannot find name 'LayoutProps'`。** 这不是真错误——`LayoutProps` 是 Next 16 构建时生成到 `.next/types` 的全局类型。跑一次 `npm run build` 或 `npm run dev` 就会生成。类型检查以 `npm run build` 为准。

---

## 9. 建议的下一步（按顺序）

1. **确认 Supabase 项目是否已创建**，配好 `.env.local`。
2. **把 `feature/db-schema` 开成 PR 并 review**（PR 还没开）。
3. **`supabase db push` 跑 migration**，按 §3.1 的清单验证 RLS。这一步大概率会暴露 SQL 里的问题，要有心理准备。
4. **生成真实类型**替换占位：
   ```bash
   npx supabase gen types typescript --project-id <REF> > src/types/database.ts
   ```
5. **开一所试点学校**（需要先跟用户确认是哪所）。
6. 然后才开始写 P0 功能，建议顺序：注册登录 → 用户资料 → 课程搜索/创建/加入 → 群聊。

---

## 10. MVP 范围

**P0（目标 10 周内完成，核心开发期 2026-09 至 2027-05）：**
- 学校邮箱注册验证、登录登出、密码找回（域名白名单限制）
- 用户资料：昵称、学校、专业、年级
- 课程搜索 / 创建 / 加入 / 退出
- 加入课程后自动建群、自动入群
- 群聊，Supabase Realtime 推送 —— **不做**已读回执、@提醒、图片消息

**P1（MVP 稳定后）：**
- 学习搭子匹配（基于课程 / 时间）
- 笔记上传与共享（Supabase Storage）
- 举报 / 内容审核机制 —— **必须在笔记功能上线前就位**

推广节奏：内部测试 → 借助现有学生社群渠道小范围 Beta → 迭代 → 正式推广（建议延后到秋季开学季）。

---

## 11. 给接手 AI 的几条提醒

- **这个项目的注释和文档是中文的**，请保持一致。
- **代码注释解释"为什么"，不复述"做了什么"。** 现有代码里的注释都是这个风格，跟着写。
- **涉及认证、权限、RLS、schema 变更的改动要格外谨慎**，这些是主开发者的责任区，改动前先确认。
- **不要假装验证过没验证的东西。** 上一轮交接时 migration 没跑过就如实说了没跑过——请保持这个标准。跑不了就说跑不了，不要写"应该没问题"。
- **遇到待定项（§5）先问，不要自己选一个填进去。**
