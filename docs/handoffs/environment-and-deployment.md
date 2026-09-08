# 环境搭建与部署交接

> 更新日期：2026-09-08
>
> 对应 commit：`main` 分支
>
> 配套阅读：[`email-otp-auth.md`](./email-otp-auth.md)（认证模块本身的交接）

## 这份文档解决什么

认证模块的代码交接见上面那份。**这一份记录的是把它真正跑起来所需要的环境配置**——因为其中有五处坑，每一处都会让系统"看起来正常但实际不工作"，而且没有一处能从代码里看出来。

新建任何一个 Supabase 项目（包括将来的生产环境），都必须照着第三节的清单走一遍。

---

## 一、当前环境状态

| | 状态 |
|---|---|
| 认证模块 | 已合并进 `main` |
| 开发用 Supabase 项目 | 主开发者自有，URL 与 key 在本地 `.env.local`（不入库） |
| 学校配置 | `uw-madison` / `wisc.edu`、`umich` / `umich.edu`，两所都已开启 |
| 邮件发送 | Brevo 自定义 SMTP，免费额度每天 300 封 |
| Vercel 项目 | `course-mate`。**生产环境已公开**：<https://course-mate-three.vercel.app>（固定网址，每次部署不变）。预览部署仍带访问保护，只有项目所有者能开 |
| Git 集成 | **未连接** —— `git push` 不会触发部署，见第四节 |
| 数据库 schema | 四个 migration 均已应用到线上项目，9 张表齐全 |
| 数据库类型 | 已从线上项目生成，不再是占位空壳 |
| 课程库 | **空的**。表已就绪，但一门课都还没录 |
| 前端 | 登录流程可用；大厅是占位页，课程仍是写死的假数据 |

当前 `main` 上 118 项测试、构建、lint、类型检查均通过。

---

## 二、本轮实测验证的结论

以下项目此前在 [`email-otp-auth.md`](./email-otp-auth.md) 中标记为"未验证"，现已在真实托管环境上跑通。**更新那份文档的 Issue #7 勾选状态时可以引用这里。**

### 已验证通过

- **真实邮箱收到六位验证码**，输入后登录成功。
- **Member Account 绑定自动创建**：邮箱首次确认时触发器建出 `member_accounts` 记录，`school_id` 正确。缺少 Profile 不影响登录，与 ADR-0001 一致。
- **准入 Hook 在托管环境生效**。直接调用公开 Auth 接口（完全绕过网站）时，以下全部返回 HTTP 403 `Email is not eligible for an enabled school.`：

  | 测试地址 | 结果 |
  |---|---|
  | `attacker@gmail.com` | 403 |
  | `student@med.umich.edu` | 403 —— 子域名不继承父域名 |
  | `fake@notumich.edu` | 403 —— 后缀仿冒 |
  | `someone@umich.edu.evil.com` | 403 —— 前缀伪装 |
  | `kwongtin@umich.edu` | 200 —— 已开放域名正常放行 |

- **匿名读 `member_accounts` 被拒绝**（`42501 permission denied`），符合"只有成员本人能读自己绑定"的策略。
- **日志脱敏有效**。发码失败时服务端日志为 `{"operation":"request_email_code","outcome":"invalid_email","schoolId":"unresolved"}`，不含邮箱地址，也不回显客户端提交的 `schoolId`。这印证了 Issue #8 的修复。
- **拒绝原因对外统一**。`invalid_email` 在代码中覆盖四种不同的失败分支，界面统一显示"请输入有效邮箱"。这是刻意设计——不泄露系统配置了哪些学校和域名。排查问题时不要把这句提示当作"邮箱格式错误"。

### 仍未验证

- 关闭浏览器后的会话保持
- 过期 / 已使用验证码的失败行为
- 重发后的 60 秒冷却
- 多设备退出隔离

### 另外验证过的：`feature/db-schema` 的 RLS

那个分支的两个 migration 此前从未执行过。现已用 `@electric-sql/pglite`（进程内 Postgres，**不需要 Docker**）完整跑通，并用三个模拟学生做了 23 项越权探针，全部通过：改他人资料、替他人加课、伪造发信人、手动改群成员、改删消息、跨校读取、同校无共同课读取——全部被拦；建课自动建群、加课自动入群、退课自动退群——全部正常。

注意这只证明"我构造的这些攻击被挡住了"，不等于没有漏洞。

---

## 三、新建 Supabase 项目的完整清单

⚠️ **跑完 SQL 只完成了一半。** 下面 2–5 步都是后台配置，代码和 migration 里都看不到，漏掉任何一步系统都会以危险或无声的方式失败。

### 1. 应用 migration

把 `supabase/migrations/` 下的 SQL 按文件名顺序贴进后台 SQL Editor 执行。不需要 Docker，也不需要 CLI。

### 2. 注册 Auth Hook ← 最危险的一步

**Authentication → Auth Hooks → Add a new hook → Before User Created**

| 字段 | 值 |
|---|---|
| 类型 | Postgres Function |
| Schema | `public` |
| Function | `hook_restrict_user_to_enabled_school` |

migration 只创建函数并给 `supabase_auth_admin` 授权，**注册钩子本身是项目设置**，`supabase/config.toml` 里也没有声明它（那份配置只对本地 CLI 栈生效）。

不注册的后果：网站表面一切正常，前端也会拒绝非法邮箱，但**任何人拿 publishable key 直接 POST `/auth/v1/otp` 就能用任意邮箱注册**。整个学校准入机制形同虚设。

**配完必须实测**，用下面三类地址各打一次，确认都返回 403：

```bash
curl -X POST "<项目URL>/auth/v1/otp" \
  -H "apikey: <publishable key>" -H "Content-Type: application/json" \
  -d '{"email":"attacker@gmail.com","create_user":true}'
```

分别测 `attacker@gmail.com`、`x@sub.<开放域名>`、`x@<开放域名>.evil.com`。

### 3. 配置自定义 SMTP

Supabase 内置的邮件服务**只发给项目组织成员**，且每小时仅几封。用它测试会出现"接口返回 200 但永远收不到信"。

**Authentication → Emails → Enable Custom SMTP**。当前用的是 Brevo（免费每天 300 封，可发任意地址）：

| 字段 | 值 |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | Brevo 的 SMTP Login |
| Password | Brevo 生成的 SMTP key |
| Sender email | **必须是已在 Brevo 验证过的发件地址** |
| Sender name | `CourseMate` |

凭据只存在于 Supabase 后台，不进代码库。`.env.example` 里那几个 `SUPABASE_AUTH_SMTP_*` 变量只给本地 CLI 栈用，托管项目不读。

发信排查看 Brevo 的 **Transactional → Logs**：没有记录说明 Supabase 根本没走 Brevo（SMTP 没生效）；有记录看状态即可定位是投递失败还是进了垃圾箱。

### 4. 替换邮件模板 ← 第二危险的一步

Supabase 默认模板发的是 `{{ .ConfirmationURL }}`（魔法链接），而本项目要的是六位验证码。**不换模板，用户收到的是一个链接，验证码框永远填不出东西。**

**Authentication → Emails → Email Templates**，`Magic Link` 和 `Confirm signup` 两个模板都要改，内容用 `supabase/templates/email-otp.html`（关键是里面的 `{{ .Token }}`），主题：

```
CourseMate 登录验证码 / Sign-in code
```

### 5. 数值设置

- **Authentication → Sign In / Providers → Email**：OTP Length = `6`，OTP Expiration = `600`
- **Authentication → Rate Limits**：每小时邮件数默认 2，测试期调到 30 左右

### 6. 开启学校

`schools` 表所有记录默认 `enabled = false`，不开启则**任何人都注册不了**。这是预期行为，不是 bug。

```sql
update public.schools set enabled = true where id = 'umich';
```

**不要把开启学校的语句写进 migration 提交**，除非正式试点学校已经定了。

---

## 四、Vercel 部署

### `NEXT_PUBLIC_*` 变量绝对不能标成 Sensitive

Vercel 的 Sensitive（Secret）类型变量在**构建阶段读不到**，而 Next.js 会在构建时把 `NEXT_PUBLIC_*` 内联进产物。两者相撞的结果是变量被编译成 `undefined`，**部署后全站 500**，运行时再怎么配也救不回来。

这两个值本来就是公开的（会打包进浏览器），标 Config 即可：

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "<url>" --no-sensitive --force
```

`EMAIL_OTP_CONTEXT_SECRET` 是服务端专用、运行时读取，保持 Secret 没问题。它**必须存在**，缺了会让发码 Server Action 直接崩。

### `git push` 不会上线 ← 最容易误解的一点

Vercel **没有连接 GitHub 仓库**。推送只是把代码送到 GitHub，Vercel 对此一无所知。线上版本只有在有人手动执行下面这句时才会更新：

```bash
npx vercel deploy --prod
```

所以「合并了修复」和「用户能用上修复」是两件独立的事。改完代码只 push 不部署，线上会一直停在旧版本，而且没有任何报错提示你。

要改成 push 自动部署，需要在 Vercel 后台把项目连上 GitHub 仓库。目前刻意没连——好处是可以先发预览版自己验，坏处就是这条容易忘。

### 旧部署 URL 会永远停在旧构建

每个 `vercel deploy` 生成一个独立不变的 URL。改完环境变量必须**重新部署**，旧链接不会自动更新。排查时先确认自己打开的是最新那个部署。

### 公开的是生产部署，预览部署仍受保护

`vercel deploy` 发的是**预览**部署，受 Vercel Authentication 保护，陌生人会被 302 送去 Vercel 登录页。`vercel deploy --prod` 发的是**生产**部署，在 Hobby 方案下不受该保护，且绑定固定网址 <https://course-mate-three.vercel.app>。

这个分工是刻意保留的，不要去关掉 Deployment Protection 开关：试验性改动先发预览版自己看，确认无误再 `--prod`，公开网址不受影响。

公开后任何人都能触发发信，但实际风险有限——Auth Hook 会拒绝 `wisc.edu` / `umich.edu` 之外的所有域名，只有这两所学校的真实邮箱能走到发信那一步。额度上限是 Brevo 每天 300 封，Supabase 侧每小时限流兜底。

---

## 五、本地开发

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

---

## 六、仍然悬而未决

### 1. 课程库是空的，前端也还没接上真实数据

课程与群聊的四个 migration **已经全部应用到线上 Supabase 项目**，9 张表齐全，类型也已重新生成。数据库这一层不再是阻塞。

`schools` 表冲突已解决：原 `feature/db-schema` 与认证模块互相矛盾（自建 `schools`、用数组做后缀匹配、把学校归属放在 `profiles`），已被重写并合并。新版本不再创建 `schools`、删掉了 `enforce_school_email` 触发器、`profiles` 去掉 `school_id`、用户外键统一引用 `member_accounts(user_id)`、权限改成「先 `revoke all` 再逐项 `grant`」。

线上匿名探测确认权限符合预期：`schools` 可读（注册页需要），其余六张业务表全部返回 `42501 permission denied`。

**剩下两件事：**

**课程库一门课都没录。** 表是空的，所以就算把前端接上也搜不到任何课。

**大厅仍是占位页。** 课程列表来自 `src/features/dashboard/placeholder-data.ts` 里写死的假数据，没有任何页面查过真实的 `courses` 表。

#### 录入课程的注意事项

当前录入方式是团队成员直接在 Supabase 后台操作（后台走 service_role，绕过所有 RLS，不需要网站账号，也不需要任何编辑权限设计）。

批量录入用 SQL Editor 一次性插，不要在 Table Editor 里一行一行点：

```sql
insert into public.courses (school_id, code, title, term) values
  ('umich', 'EECS 280', 'Programming and Introductory Data Structures', '2026-fall'),
  ('umich', 'STATS 250', 'Introduction to Statistics and Data Analysis', '2026-fall');
```

三个坑：

- **`code_normalized` 不能出现在插入语句或 CSV 里**，它是数据库自动算出来的生成列，手填直接报错
- **每插一门课会自动建一个群**，触发器干的，是预期行为
- **`created_by` 会是 NULL**，因为后台没有登录用户。这对官方课表条目是合理的，但意味着这些课不属于任何学生

数据库会拦住：学期格式不对、`school_id` 不存在、同学期同门课重复。**拦不住**：课名写成乱码、课号张冠李戴——只能靠人核对。

录完验证课程数与群组数应当相等：

```sql
select (select count(*) from public.courses) as 课程数,
       (select count(*) from public.groups) as 群组数;
```

#### 已讨论但决定暂不做的：`school_editors`

曾考虑加一张 `(user_id, school_id)` 的编辑权限表，让课表编辑权按学校隔离。**结论是现在不做**——团队成员用 Supabase 后台录入时 service_role 绕过 RLS，这张表在有管理页之前是死代码。

等到要给第三个人录课、又不想再开数据库权限时再加。届时注意一个坑：查看策略目前是「只能看自己学校的课」，如果只加写权限不改这条，会做出一个**能插入却看不见自己插入内容**的编辑角色。

### 2. GitHub 仓库设置 —— CODEOWNERS 目前是一张不生效的纸

`.github/CODEOWNERS` 的路径已经修正（`/src/features/auth/` 与 `/src/lib/server-env.ts` 都已纳入），但**分支保护与 "Require review from Code Owners" 仍未在 GitHub 仓库设置里开启**，所以这份名单当前不拦任何人。

这件事的优先级比字面看起来高：协作者同时拥有 Supabase 后台权限和向 `main` 直接 push 的能力（见下一条）。

### 3. 协作者已获得 Supabase 后台权限

2026-09-07 起，协作者被授予 Supabase 组织的 Developer 角色。**Supabase 免费版没有只读或细粒度角色**——任何组织成员都能看到 service_role key、关闭 RLS、读取全部用户邮箱、修改 Auth Hook。

也就是说，代码层的隔离（CODEOWNERS、模块划分）依然成立，但"协作者碰不到权限"在基础设施层已不再成立。主开发者在了解这些代价后仍决定授权，改用口头约定补位：动 Auth Hook 前须打招呼、service_role key 不进代码库、两个账号都开 2FA、日常 UI 开发走本地环境变量而不是开后台。

接手时不要再假设协作者只能改 UI。

### 4. 产品层面待定

试点学校（当前两所都开着只是测试配置）、是否做中国留学生定位与双语 UI、是否引入 `next-intl`。**遇到这些先问，不要自行假设。**

---

## 七、给接手 AI 的提醒

- 文档与注释使用中文，注释解释"为什么"而非复述"做了什么"。
- **不要假装验证过没验证的东西。** 这份文档严格区分了"实测通过"和"仍未验证"，请保持这个标准。
- 涉及认证、RLS、schema 的改动属于主开发者职责区，动手前先确认。
- 排查"配置正确却不工作"的问题时，先回到第三节逐条核对——五个坑里有四个都是后台设置，代码里查不出来。
