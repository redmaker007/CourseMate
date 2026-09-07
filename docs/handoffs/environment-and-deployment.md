# 环境搭建与部署交接

> 更新日期：2026-09-07
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
| Vercel 项目 | `course-mate`，preview 部署带访问保护，仅项目所有者可见 |
| Git 集成 | **未连接**，目前用 `npx vercel deploy` 手动部署 |

`feature/email-otp-auth` 分支已并入 `main`，合并后 98 项测试与生产构建均重新跑过并通过。

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

## 四、Vercel 部署的两个坑

### `NEXT_PUBLIC_*` 变量绝对不能标成 Sensitive

Vercel 的 Sensitive（Secret）类型变量在**构建阶段读不到**，而 Next.js 会在构建时把 `NEXT_PUBLIC_*` 内联进产物。两者相撞的结果是变量被编译成 `undefined`，**部署后全站 500**，运行时再怎么配也救不回来。

这两个值本来就是公开的（会打包进浏览器），标 Config 即可：

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "<url>" --no-sensitive --force
```

`EMAIL_OTP_CONTEXT_SECRET` 是服务端专用、运行时读取，保持 Secret 没问题。它**必须存在**，缺了会让发码 Server Action 直接崩。

### 旧部署 URL 会永远停在旧构建

每个 `vercel deploy` 生成一个独立不变的 URL。改完环境变量必须**重新部署**，旧链接不会自动更新。排查时先确认自己打开的是最新那个部署。

当前 preview 部署带访问保护，陌生人访问会 302 跳到 Vercel 登录页。要公开访问需要部署到正式环境（`vercel deploy --prod`），届时要考虑：任何人都能触发发信，消耗 SMTP 额度。

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

### 1. `feature/db-schema` 与认证模块的 `schools` 表冲突 —— 当前最大阻塞

两个分支都写了 `create table public.schools`，且都没有 `if not exists`，同库跑第二个必然报错。底层模型也互相矛盾：

| | `feature/db-schema` | 已合并的认证模块 |
|---|---|---|
| 域名存储 | `schools.domains` 数组 | 独立 `school_email_domains` 表 |
| 匹配方式 | 后缀匹配，**接受**子域名 | 精确匹配，**拒绝**子域名 |
| 学校归属 | `profiles.school_id` | `member_accounts.school_id` |
| 拦截时机 | 创建 profile 时 | 创建 Auth 用户之前 |

**这个分歧事实上已经有答案了**：精确匹配那套已经合并进 `main` 并在真实环境验证生效（`med.umich.edu` 被 403 拒绝）。

因此 `feature/db-schema` 需要改造：删掉它自己的 `schools`、`profiles.school_id` 绑定和 `enforce_school_email` 触发器，保留 `courses` / `course_members` / `groups` / `group_members` / `messages` 这套业务表，学校归属改从 `member_accounts` 读。基本要重写第一个 migration。

**注意**：`feature/db-schema` 的 migration 文件名是 14 位时间戳（`20260903000001`），认证模块是 12 位（`202609050001`）。改造时统一格式。

### 2. `fix/codeowners-auth-paths` 分支未合并

认证代码已随 `main` 落地在 `/src/features/auth/`，但 `main` 上的 CODEOWNERS 仍只锁着已经不存在的 `/src/lib/auth/`。**现状是修改认证逻辑不需要主开发者审批。** 该分支同时把持有签名密钥的 `/src/lib/server-env.ts` 纳入保护。

### 3. GitHub 仓库设置

分支保护与 "Require review from Code Owners" **仍未开启**。CODEOWNERS 文件本身不会自动生效。

### 4. 产品层面待定

试点学校（当前两所都开着只是测试配置）、是否做中国留学生定位与双语 UI、是否引入 `next-intl`。**遇到这些先问，不要自行假设。**

---

## 七、给接手 AI 的提醒

- 文档与注释使用中文，注释解释"为什么"而非复述"做了什么"。
- **不要假装验证过没验证的东西。** 这份文档严格区分了"实测通过"和"仍未验证"，请保持这个标准。
- 涉及认证、RLS、schema 的改动属于主开发者职责区，动手前先确认。
- 排查"配置正确却不工作"的问题时，先回到第三节逐条核对——五个坑里有四个都是后台设置，代码里查不出来。
