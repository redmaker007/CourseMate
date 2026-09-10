# 课程目录并入主干交接

> 更新日期：2026-09-10
>
> 相关：[统一会话核心](./unified-conversation-core.md) · [Profile onboarding](./profile-onboarding.md) · [好友后端](./friendship-backend.md) · [录入课程 runbook](../runbooks/seed-courses.md)

## 背景：两条线撞车了

两名开发者在互不知情的情况下各自推进：

| 分支 | 内容 |
|---|---|
| `feature/one-to-one-chat` | 统一会话核心、Profile onboarding、好友与私聊后端、**课程流程（#13）** |
| `main` | **课程目录 `course_catalog` 与官方课表导入脚本** |
| `feature/course-search-and-join` | 课程搜索、加入、退课——**与 #13 重复** |

前者是从 `bad7a76` 分出去的，比课程目录合进 `main` 还早，所以完全不知道目录的存在。

决定：**以 `feature/one-to-one-chat` 为主干合并**，它是一套更完整、自洽的架构；`feature/course-search-and-join` 作废；同时保住课程录入这条链路。集成分支是 `integrate/one-to-one-chat`，没有改动原来的 `feature/one-to-one-chat`。

---

## 合并时暴露的问题与处理

| 问题 | 处理 |
|---|---|
| 两边 migration 用了同一个版本号 `202609090001` | 他的 `profile_onboarding` 改为 `202609090002`，preflight 同步改名，7 个文件共 9 处引用一并更新 |
| 当前学期存了两份：`schools.current_term` 和 `school_term_settings` | 删除前者。后者还会在学期切换时自动归档旧会话，设计更完整 |
| 课程流程禁止学生建课，只能加入已存在的 `courses`；而导入写的是 `course_catalog` | 新增 `materialize_catalog_courses()`，把目录物化成当前学期的 `courses` |
| 课程目录建立时 ADR-0004 还不存在，读取没有 onboarding 门槛 | 补上，与其他课程数据一致 |
| `src/types/database.ts` 冲突 | 取他的版本，拼入 `course_catalog` 的类型块。**部署后必须从线上重新生成**，见下文 |

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

## ⚠️ 上线顺序

线上 Supabase 目前只有前五个 migration（到 `202609090001_course_catalog`），外加那列要删的 `schools.current_term`。**必须严格按下面的顺序：**

1. 按 [profile-onboarding.md](./profile-onboarding.md) 先跑只读 preflight：`supabase/preflight/202609090002_profile_onboarding.sql`
2. 在 SQL Editor 依次执行：
   - `202609090002_profile_onboarding.sql`
   - `202609100001_unified_conversation_core.sql`
   - `202609100002_course_flow.sql`
   - `202609100003_friendship_backend.sql`
   - `202609100004_integrate_course_catalog.sql`
3. 从线上重新生成类型，替换手工拼接的版本：
   ```bash
   npx supabase gen types typescript --project-id <REF> > src/types/database.ts
   ```
4. 导入课表（已导入过则用 `--materialize-only`），见 [录入课程 runbook](../runbooks/seed-courses.md)
5. `npx vercel deploy --prod`——`git push` 不会触发部署

**先迁移、后部署代码。** 反过来的话，新代码会去查线上还不存在的 `conversations`、`school_term_settings`，全站报错。而先迁移是安全的：线上当前的代码不读 `groups`、不读课程表，删掉 `groups` 和改名 `messages.group_id` 不影响它。

---

## 验证了什么

| | |
|---|---|
| 全量测试 | **259 项通过**（40 个文件，含两边的全部测试） |
| 集成测试 | `supabase/migrations/course-catalog-integration.test.ts`，12 项 |
| 构建 / lint / 类型检查 | 通过 |
| 导入脚本预演 | 通过；`--materialize-only` 缺凭据时正确拒绝 |

集成测试是**唯一一个按真实顺序跑完全部十个 migration 的测试**。其余测试各自只跑到自己需要的那一步，足以验证各自功能，但证明不了两条独立开发的线叠在一起还能工作。它覆盖：完整链路可跑通、学期只有一个来源、目录的 onboarding 与跨校门槛、学生调不动物化、合规建课 / 不合规跳过、幂等、自动配会话、加入后自动成为会话成员、没设学期时拒绝、学期切换后旧会话归档且新学期建出新课。

### 没验证的

- **这五个 migration 都没在真实 Supabase 上跑过**，只在 PGlite 里验证过。线上第一次执行时仍可能遇到平台差异。
- 物化函数由真实 PostgREST `rpc()` 调用、以及真实课表规模下的耗时，都没测过。
- `database.ts` 是手工拼接的，与线上真实 schema 可能有细微出入，所以上线顺序第 3 步不能跳过。

---

## 作废的东西

- `feature/course-search-and-join` 分支：`/courses` 搜索页、加入退课 Server Action、`schools.current_term`。功能被 #13 覆盖，分支尚未删除。
- 旧的 `supabase/migrations/course-and-chat-rls.test.ts` 仍然保留，它只跑到课程目录那一步，测的是统一会话之前的中间状态（其中还有 `groups` 表）。它依然有效，但描述的不是最终 schema。

## 需要协调的事

- **`feature/one-to-one-chat` 上如果还在继续开发，需要先合并这次的结果**——他的 `profile_onboarding` migration 已经改名，新写的测试若再按旧文件名串联会找不到文件。
- ADR 编号目前是 0001、0002、0004，**缺 0003**。不确定是跳号还是有一篇尚未提交。
