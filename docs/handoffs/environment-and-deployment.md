# 环境与部署交接

> 更新日期：2026-09-08
>
> 配套阅读：[认证模块交接](./email-otp-auth.md) · [前端路由与大厅](./frontend-routing-and-dashboard.md)

## 这份文档解决什么

**记录「现在到了哪一步、还欠什么」——这些内容会过期，需要定期更新。**

具体怎么做某件事（配 Supabase、部署、本地跑起来、录课、申请数据授权）全部搬去了 `docs/runbooks/`，那些内容不随进度变化。两类分开是刻意的：三个月后本文档的「当前状态」多半已经不准，但 runbook 里的步骤依然一字不差地有效——混在一起会让读者连带怀疑后者。

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

## 三、操作手册

| Runbook | 什么时候看 |
|---|---|
| [新建 Supabase 项目](../runbooks/new-supabase-project.md) | 建新项目时。**跑完 SQL 只完成一半**，还有四处后台设置在代码里看不到，漏掉会让系统以危险或无声的方式失败 |
| [部署](../runbooks/deploy.md) | 要上线时。注意 `git push` **不会**触发部署 |
| [本地开发](../runbooks/local-development.md) | 新人第一次把项目跑起来 |
| [录入课程](../runbooks/seed-courses.md) | 往课程库灌数据时 |
| [申请课程数据授权](../runbooks/request-course-data.md) | 要拿学校的官方课表数据时 |

决策与理由在 [`docs/adr/`](../adr/)。为什么不逆向学校的课程接口，见 [ADR-0002](../adr/0002-do-not-reverse-engineer-university-course-search.md)。

---

## 四、仍然悬而未决

### 1. 课程库是空的，前端也还没接上真实数据

课程与群聊的四个 migration **已经全部应用到线上 Supabase 项目**，9 张表齐全，类型也已重新生成。数据库这一层不再是阻塞。

`schools` 表冲突已解决：原 `feature/db-schema` 与认证模块互相矛盾（自建 `schools`、用数组做后缀匹配、把学校归属放在 `profiles`），已被重写并合并。新版本不再创建 `schools`、删掉了 `enforce_school_email` 触发器、`profiles` 去掉 `school_id`、用户外键统一引用 `member_accounts(user_id)`、权限改成「先 `revoke all` 再逐项 `grant`」。

线上匿名探测确认权限符合预期：`schools` 可读（注册页需要），其余六张业务表全部返回 `42501 permission denied`。

**剩下两件事：**

**课程库一门课都没录。** 表是空的，所以就算把前端接上也搜不到任何课。

**大厅仍是占位页。** 课程列表来自 `src/features/dashboard/placeholder-data.ts` 里写死的假数据，没有任何页面查过真实的 `courses` 表。

录入方式与注意事项见 [录入课程 runbook](../runbooks/seed-courses.md)；数据授权申请见 [申请课程数据授权](../runbooks/request-course-data.md)。

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

## 五、给接手 AI 的提醒

- 文档与注释使用中文，注释解释"为什么"而非复述"做了什么"。
- **不要假装验证过没验证的东西。** 这份文档严格区分了"实测通过"和"仍未验证"，请保持这个标准。
- 涉及认证、RLS、schema 的改动属于主开发者职责区，动手前先确认。
- 排查"配置正确却不工作"的问题时，先翻 [新建 Supabase 项目 runbook](../runbooks/new-supabase-project.md) 逐条核对——那几个坑几乎都是后台设置，代码里查不出来。
- 改动本文档时注意：**只更新状态和待办**。操作步骤属于 runbook，写回这里会让两边不一致。
