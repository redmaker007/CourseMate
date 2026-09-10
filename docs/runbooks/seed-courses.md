# Runbook：录入课程

> 数据授权申请见 [request-course-data.md](./request-course-data.md)。
>
> 为什么不逆向学校的公开课程接口，见 [ADR-0002](../adr/0002-do-not-reverse-engineer-university-course-search.md)。

## 先搞清楚要导进哪张表

这是这块最容易搞混的一点：

| 表 | 是什么 | 带学期 | 会建会话 | 学生能加入 |
|---|---|---|---|---|
| `course_catalog` | 这所学校**开过哪些课** | ❌ | ❌ | ❌ |
| `courses` | **这学期这门课** | ✅ | ✅ 自动 | ✅ |

**批量导入官方课表 → `course_catalog`，再物化成当前学期的 `courses`。**

课程流程（#13）规定**学生不能建课**，只能加入当前学期已经存在的 `courses`，而且搜索读的也是 `courses`。所以目录导进来之后必须物化，否则学生既搜不到也加不了。导入脚本写完目录后会自动完成这一步。

目录不带学期，一次导入长期有效；物化出的 `courses` 带学期，每学期重新物化一次即可，**课表不用重导**。

---

## 批量导入

### 一、准备文件

Google Sheet → **文件 → 下载 → Microsoft Excel (.xlsx)**。整个工作簿下成一个文件，不用逐个分页导 CSV。

工作簿结构需要是：

- **一个索引页**（默认叫 `Index`，可用 `--index` 指定别的名字）
  `Subject Code | Short Name | Full Department Name | Course Count | Sheet`
- **每个院系一个分页**，表头为
  `Course Code | Title | Credits | Subject | Typically Offered | Prerequisites | Description | Source Course ID | Term`

索引页的 `Short Name`（如 `ACCT I S`）是必需的——UW 的学科缩写自身含空格，`ACCT I S 100` 不能按空格切开，脚本靠这张表做最长前缀匹配。

### 二、先预演

```bash
node scripts/import-course-catalog.mts --file 课表.xlsx --school uw-madison
```

**默认不写库**，只打印报告。报告会告诉你三件事：

| 报告项 | 含义 |
|---|---|
| 与索引页 Course Count 对不上的院系 | 源数据自带的对账基准。对不上说明有行被跳过了 |
| 无法解析的行 | 课号匹配不到任何已知学科、或课名为空 |
| 重复课号 | 规范化后撞车的行，保留第一条 |

一行坏数据通常会**同时出现在前两项里**——这是刻意的冗余，单看一处容易漏。

**报告干净之前不要 `--apply`。**

### 三、确认无误后写入

```bash
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import-course-catalog.mts \
  --file 课表.xlsx --school uw-madison --apply
```

⚠️ **service_role key 只从进程环境变量读，脚本不会去读 `.env.local`。** 这是刻意的：那把钥匙绕过全部 RLS，不该落在磁盘上等着被误提交。像上面那样只在这一条命令前临时提供。

写入前会**先只写 1 行做预检**。冲突目标写错、字段名不对这类问题会在第 1 行就暴露，而不是跑到第 5000 行才失败。

写入是 upsert（冲突键为 `school_id + code_normalized`），**可以重复执行**。中途失败修正后直接重跑即可，不用先清库。

### 四、物化成当前学期的课程

`--apply` 写完目录后会自动调用 `materialize_catalog_courses()`，输出形如：

```
学期 2026-fall：新建 N 门，已存在 M 门
另有 K 门因课号超过 20 字或课名超过 120 字未能物化（目录里保留原文，未截断）
```

- **不合规的行跳过而不截断**。`courses` 的约束比目录严，截断会静默改掉学校原文。
- **幂等**，已存在的课跳过，可以放心重跑。
- 学校**没设当前学期时会报错**，而不是猜一个。先在 `school_term_settings` 里设好。
- 物化失败时目录已经写入，修正后用下面的 `--materialize-only` 补跑即可。

---

## 每学期切换

更新 `school_term_settings.current_term` 之后重新物化，**不用重导课表**：

```sql
update public.school_term_settings set current_term = '2027-spring'
where school_id = 'uw-madison';
```

```bash
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/import-course-catalog.mts   --school uw-madison --materialize-only
```

切换学期时，旧学期的课程会话由触发器自动归档，历史消息与成员保留。

---

## 手工补录单门课

学生反馈某门课搜不到时，**补进目录再物化**，不要直接往 `courses` 里插：

```sql
insert into public.course_catalog (school_id, code, subject, number, title) values
  ('umich', 'EECS 280', 'EECS', '280', 'Programming and Introductory Data Structures');
```

然后跑一次 `--materialize-only`。

直接插 `courses` 也能让它这学期可见，但目录里没有它，**下学期物化时就不会再出现**。目录才是课程的唯一来源。

几个坑：

- **`code_normalized` 不能出现在插入语句里**，它是生成列，手填直接报错
- `subject` 与 `number` 是必填的，要与 `code` 对应（`EECS 280` → `EECS` / `280`）
- 物化出的每门课都会自动建一个课程会话，是预期行为
- 物化建出的课 `created_by` 为 NULL，不属于任何学生

数据库会拦住：学期格式不对、`school_id` 不存在、重复录入。**拦不住**：课名写成乱码、课号张冠李戴——只能靠人核对。

物化后验证课程数与课程会话数应当相等：

```sql
select (select count(*) from public.courses) as 课程数,
       (select count(*) from public.course_conversations) as 课程会话数;
```

---

## 已讨论但决定暂不做的：`school_editors`

曾考虑加一张 `(user_id, school_id)` 的编辑权限表，让课表编辑权按学校隔离。**结论是现在不做**——团队成员用 Supabase 后台或导入脚本时都走 service_role，绕过 RLS，这张表在有管理页之前是死代码。

等到要给第三个人录课、又不想再开数据库权限时再加。届时注意一个坑：查看策略目前是「只能看自己学校的」，如果只加写权限不改这条，会做出一个**能插入却看不见自己插入内容**的编辑角色。
