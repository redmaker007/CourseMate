# 课程目录并入主干交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

> 更新日期：2026-09-10
>
> 相关：[统一会话核心](./unified-conversation-core.md) · [Profile onboarding](./profile-onboarding.md) · [好友后端](./friendship-backend.md) · [录入课程 runbook](../runbooks/seed-courses.md) · [新建 Supabase 项目 runbook](../runbooks/new-supabase-project.md)

## 背景：两条线撞车了

两名开发者在互不知情的情况下各自推进：

| 分支 | 内容 |
|---|---|
| `feature/one-to-one-chat` | 统一会话核心、Profile onboarding、好友与私聊后端、**课程流程（#13）** |
| `main` | **课程目录 `course_catalog` 与官方课表导入脚本** |
| `feature/course-search-and-join` | 课程搜索、加入、退课——**与 #13 重复** |

前者是从 `bad7a76` 分出去的，比课程目录合进 `main` 还早，所以完全不知道目录的存在。

决定：**以 `feature/one-to-one-chat` 为主干合并**，它是一套更完整、自洽的架构；`feature/course-search-and-join` 作废；同时保住课程录入这条链路。合并先在 `integrate/one-to-one-chat` 上完成并验证，再快进到 `main`。原来的 `feature/one-to-one-chat` 没有被改动。

---

## 合并时暴露的问题与处理

| 问题 | 处理 |
|---|---|
| 两边 migration 用了同一个版本号 `202609090001` | 他的 `profile_onboarding` 改为 `202609090002`，preflight 同步改名，7 个文件共 9 处引用一并更新 |
| 当前学期存了两份：`schools.current_term` 和 `school_term_settings` | 删除前者。后者还会在学期切换时自动归档旧会话，设计更完整 |
| 课程流程禁止学生建课，只能加入已存在的 `courses`；而导入写的是 `course_catalog` | 新增 `materialize_catalog_courses()`，把目录物化成当前学期的 `courses` |
| 课程目录建立时 ADR-0004 还不存在，读取没有 onboarding 门槛 | 补上，与其他课程数据一致 |
| `src/types/database.ts` 冲突 | 取他的版本，拼入 `course_catalog` 的类型块。迁移上线后已从线上重新生成，替换了拼接版本 |

关于 `schools.current_term`：它是作废分支上的产物，已经被手工应用到了线上项目，但对应的 migration 从未进入 `main`——典型的迁移漂移。`202609100004` 用 `drop column if exists` 删掉它，照 `main` 重建的库没有这一列，那里是空操作。

---

## 课程录入现在是怎么走通的

```
官方课表 xlsx
   │  scripts/import-course-catalog.mts --apply
   ▼
course_catalog          不带学期、不建会话，一次导入长期有效
   │  materialize_catalog_courses(school)   ← 导入脚本最后自动调用
   ▼
courses（当前学期）     create_conversation_for_course 自动配好课程会话
   │  学生搜索、加入（#13 的课程流程）
   ▼
course_members → conversation_members（由 sync_course_conversation_membership 同步）
```

**不物化的话，导入的课学生既搜不到也加不了**——#13 的搜索读的是 `courses`，不是 `course_catalog`。这是这次衔接的核心。

### 物化函数的几个性质

- **只有 service_role 能调**。执行权对 `public` / `anon` / `authenticated` 全部收回——物化会批量建课并连带建出会话，而课程流程本来就禁止学生建课。
- **幂等**。冲突键是 `courses` 原有的 `(school_id, code_normalized, term)` 唯一索引，已存在的跳过。
- **跳过而不截断**。`courses` 的约束比目录严（课号 2–20 字、课名 1–120 字），不合规的行计数后跳过。截断会静默改掉学校原文，截出来的课号还可能撞上别的课。
- **没设学期就报错**，不猜一个学期出来。

### 每学期要做什么

更新 `school_term_settings.current_term` 之后重新物化即可，**课表不用重导**：

```bash
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import-course-catalog.mts \
  --school uw-madison --materialize-only
```

切换学期时，旧学期的课程会话会被 #13 的触发器自动归档，历史消息与成员保留。

### 一个已知代价

课程流程的设计是「课程由目录预置」，所以物化会为每门课建一个会话。**一所学校几千门课，就是几千个空会话。** 这是那个设计的固有代价，不是 bug。如果将来成为问题，方向是改成「第一个学生加入时才物化该门课」，而不是批量预置。

---

## 上线过程中发现的两个问题

### 1. SQL Editor 不按事务执行 migration

在 SQL Editor 里执行 `202609100001_unified_conversation_core.sql` 时报错：

```
ERROR: 42P01: relation "_legacy_conversation_messages" does not exist
```

查明的原因：

- SQL Editor 把每条语句**单独提交**，文件里的 `begin; … commit;` 不生效
- **遇到错误不会停**，报错之后的语句照样执行
- 该文件第 9 行的临时表是 `on commit drop`，单独提交后立即消失，第 141 行的校验块自然找不到它

证据全部来自线上实测：

| 观察 | 说明 |
|---|---|
| `can_access_course_conversation` 等函数存在 | 它们在第 374 行之后才创建，在报错点之后 |
| `groups`、`group_members` 已不存在 | 删除它们的语句在第 188–189 行，同样在报错点之后 |
| `messages.group_id` 已改名为 `conversation_id` | 报错点之前的语句 |

随后的诊断查询确认：结构完整——旧表已删、`messages` 已改列、4 张新表均已开 RLS、5 条策略与触发器齐全；而课程、选课、消息三张表在迁移前都是空的。所以唯一没生效的校验块本来就无事可验，**没有数据丢失**。

更值得记住的一点是：这个文件的注释写着「断言失败会回滚，旧表不会删除」。**在 SQL Editor 里这个保证不成立**：校验失败了，删旧表的语句照样执行了。剩下几个文件没有临时表，也没有「先校验、后删除」这种写法，不会踩同一个坑，但同样不是原子执行，任何报错都会留下改到一半的状态。

操作规则已写进 [新建 Supabase 项目 runbook](../runbooks/new-supabase-project.md)。

### 2. 函数执行权收回得不完整

用未登录身份调用 `can_access_course_conversation`，得到的是 `false`，而不是权限拒绝——这个函数只授予了 `authenticated`。

原因：Supabase 会通过 default privileges 把 public schema 里**新函数的执行权单独授予 `anon` 和 `authenticated`**。此前所有 migration 都只写了 `revoke execute … from public`，只收回了 PUBLIC 这一级，收不回这两份单独的授权。**两位开发者的代码都有这个问题**，课程权限 migration（`202609070002`）也是。

线上 `pg_default_acl` 确认了这条默认授权的位置：挂在 `postgres` 角色的 `public` schema 级，内容是 `anon=X`、`authenticated=X`。SQL Editor 以 `postgres` 身份执行，所以经它建的每个函数都会被自动授予。`supabase_admin` 另有一条同样的默认授权，那是平台自己用的，我们的 migration 不经过它，也不应去改。

影响分三类：

| 函数 | 影响 |
|---|---|
| `members_are_blocked(a, b)` | **真正的泄露点**。本意只在内部使用，但它不校验调用者，任何客户端传入两个成员 ID 就能知道两人之间有没有拉黑 |
| `consume_friend_rate_limit` | 本意内部使用。按 `auth.uid()` 计数，直接调用只会消耗调用者自己的额度 |
| 其余按 `auth.uid()` 计算的函数 | 未登录时查的是空用户，只得到 `false` 或空值，无实际泄露 |

本地测试一直没发现，是因为 PGlite 测试桩只复刻了**表**的 default privileges，没复刻**函数**的。

处理：新增 `202609100005_harden_function_execute_grants.sql`：

- 收回 default privileges，以后新建的函数不再自动开放给客户端
- `anon`：除登录页必需的 `enabled_school_id_for_email_domain` 外全部收回
- 两个内部辅助函数连 `authenticated` 也收回。它们只被其他 `security definer` 函数在内部调用，以属主身份执行，不需要调用者有执行权；也没有任何 RLS 策略用到它们
- RLS 策略依赖的函数（`current_school_id`、`has_completed_onboarding` 等）保留 `authenticated` 的执行权，否则策略本身会失效

测试桩已补上函数的 default privileges。集成测试**先断言修复前漏洞确实存在**——证明测试环境真的复现了问题，而不是在空转——再按 `pg_proc` 枚举断言修复后未登录用户只能执行那一个函数。以后新加函数忘了收回，这条会直接失败。

---

## 上线进度

| 步骤 | 状态 |
|---|---|
| preflight `202609090002_profile_onboarding.sql` | ✅ 0 个受影响用户 |
| `202609090002_profile_onboarding` | ✅ |
| `202609100001_unified_conversation_core` | ✅ 非原子执行、校验块失败，但诊断确认结构完整；相关表原本为空，无数据丢失 |
| 诊断查询 | ✅ 11 项全部符合预期 |
| `202609100002_course_flow` | ✅ |
| `202609100003_friendship_backend` | ✅ |
| `202609100004_integrate_course_catalog` | ✅ |
| `202609100005_harden_function_execute_grants` | ✅ 线上实测：6 个受限函数对未登录用户全部拒绝，登录必需的函数仍可用 |
| 从线上重新生成 `src/types/database.ts` | ✅ 1035 行，替换了手工拼接的版本 |
| `npx vercel deploy --prod` | ✅ 2026-09-10，部署 `38b0636`。部署前核对过环境变量：新代码没有引入新的必需变量 |
| 热修复：新成员无法保存资料 | ✅ 2026-09-10，部署 `3a43aa2`。见下文「上线后发现的问题」 |
| 导入并物化课表 | 待执行，见 [录入课程 runbook](../runbooks/seed-courses.md)。在部署之后做没有问题：课程库空着时网站照常运行，只是搜课没有结果 |

**先迁移、后部署代码。** 反过来的话，新代码会去查线上还不存在的 `school_term_settings` 等表，全站报错。而先迁移是安全的：线上当前的代码不读 `groups`、不读课程表。

**`202609100005` 必须在部署代码之前执行。** 在它之前，好友后端的函数对客户端开放；那时 `member_blocks` 还是空的，没有可泄露的数据，但不要把这个窗口留到上线之后。

---

## 验证了什么

| | |
|---|---|
| 全量测试 | **268 项通过**（40 个文件，含两边的全部测试） |
| 集成测试 | `supabase/migrations/course-catalog-integration.test.ts`，21 项 |
| 构建 / lint / 类型检查 | 通过 |
| 导入脚本预演 | 通过；`--materialize-only` 缺凭据时正确拒绝 |
| 线上外部探测 | 受限函数对未登录用户全部拒绝；登录必需函数可用；新表齐全；`schools.current_term` 已删；学校邮箱 Hook 仍返回 403 |
| 部署后冒烟（未登录） | `/login` 200 且列出两所学校；`/`、`/dashboard`、`/courses/*`、`/onboarding`、`/profile` 全部 307 跳转登录并带上 `next`；无 500，部署日志无报错 |

集成测试是**唯一一个按真实顺序跑完全部 migration 的测试**。其余测试各自只跑到自己需要的那一步，足以验证各自功能，但证明不了两条独立开发的线叠在一起还能工作。它覆盖：完整链路、学期单一来源、函数执行权（修复前后对照、枚举检查、内部辅助函数、公开接口仍可间接使用、策略依赖函数仍可用、新函数默认不开放）、目录的 onboarding 与跨校门槛、学生调不动物化、合规建课 / 不合规跳过、幂等、自动配会话、加入后自动成为会话成员、没设学期时拒绝、学期切换后旧会话归档且新学期建出新课。

### 上线后发现的问题：新成员卡在 onboarding

**现象。** 验证码登录成功后进入「先取一个显示名称」，点保存只提示「资料暂时无法保存，请稍后重试」，永远进不了主应用；老成员在 `/profile` 也改不了资料。

**根因。** 两处组员的代码各自正确、叠在一起出错：

- `production-profile-service.ts` 用 `upsert` 保存资料，也就是 `INSERT … ON CONFLICT DO UPDATE`
- `202609100003_friendship_backend` 把 `profiles` 的读取权限收窄成 `id` / `display_name` / `avatar_url` 三列，`major` / `grad_year` 只能经 `get_own_profile()` 读到

Postgres 要求 `ON CONFLICT DO UPDATE` 对被更新的列有读取权限，于是整句 `permission denied for table profiles`。单独的 `insert` 和 `update` 不受影响。onboarding 的测试只跑到它自己那一步 migration，没有叠上好友后端，所以测试全绿。

**修复（`3a43aa2`）。** 改为先 `insert`，遇到唯一约束冲突（`23505`）再 `update`。没有放宽列级权限——同课同学本来就不该直接读到别人的专业和毕业年份。集成测试补了两项：完整链路下按网站写法保存成功，以及 upsert 确实会被拒（防止有人改回去）。

**教训。** 收窄表或列权限的 migration，要搜一遍应用代码里对这张表的所有写法（尤其 `upsert`、`.select()` 链在写入后面）。验证只能靠跑完全部 migration 的测试。

### 没验证的

- 物化函数由真实 PostgREST `rpc()` 调用、以及真实课表规模下的耗时，都没测过——第一次导入课表时才会跑到
- 登录之后的完整流程（onboarding、加入课程、课程会话、好友）没有在线上由真人点过——验证码邮件我这边收不到
- `202609100005` 里全局级的那条 `revoke` 已确认是空操作（线上没有全局默认授权），保留无害

---

## 作废的东西

- `feature/course-search-and-join` 分支：`/courses` 搜索页、加入退课 Server Action、`schools.current_term`。功能被 #13 覆盖，分支已于 2026-09-10 删除；唯一未合并的提交是 `75dd300`，需要时可按编号找回。
- 同日一并删除：`feature/db-schema`（未合并提交 `ff5b596`，最早一版 schema，与认证 Spec 冲突，已被 `81313be` 重写取代）、`feature/course-and-chat-schema` 与 `integrate/one-to-one-chat`（均已完整并入 `main`）。组员的 `feature/one-to-one-chat` 保留。
- 旧的 `supabase/migrations/course-and-chat-rls.test.ts` 仍然保留。它只跑到课程目录那一步，测的是统一会话之前的中间状态（其中还有 `groups` 表），依然有效，但描述的不是最终 schema。

## 需要协调的事

- **`main` 已经更新。** 在 `feature/one-to-one-chat` 上继续开发之前，要先把 `main` 合进去——他的 `profile_onboarding` migration 已经改名，新写的测试若再按旧文件名串联会找不到文件。
- **函数执行权的写法要改。** 以后写函数要写全 `revoke … from public, anon, authenticated`，只被内部调用的辅助函数不要授予任何客户端角色。
- **资料保存已改过。** 他的 `production-profile-service.ts` 不再用 `upsert`，原因见上文「上线后发现的问题」。以后收窄表权限时，要连带检查所有写这张表的代码；新写的数据库测试要跑完全部 migration，至少叠上会影响同一张表的那几个。
- ADR 编号目前是 0001、0002、0004，**缺 0003**。不确定是跳号还是有一篇尚未提交。
