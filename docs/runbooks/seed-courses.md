# Runbook：录入课程

> 数据授权申请见 [request-course-data.md](./request-course-data.md)。
>
> 为什么不逆向学校的公开课程接口，见 [ADR-0002](../adr/0002-do-not-reverse-engineer-university-course-search.md)。

## 先搞清楚要导进哪张表

这是这块最容易搞混的一点：

| 表 | 是什么 | 带学期 | 会建群 | 学生能加入 |
|---|---|---|---|---|
| `course_catalog` | 这所学校**开过哪些课** | ❌ | ❌ | ❌ |
| `courses` | **这学期这门课的那个群** | ✅ | ✅ 自动 | ✅ |

**批量导入官方课表 → `course_catalog`。**

不要把整份课表灌进 `courses`。那会立刻产生几千个空群（每插一行触发一次自动建群），而且因为 `term` 是必填的，每学期都要重导一遍。

`courses` 里的行应该在**第一个学生真的要加入某门课时**才创建。

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

---

## 手工录入单门课

给 `courses` 补个别课程时（比如学生反馈某门课搜不到），在 SQL Editor 里：

```sql
insert into public.courses (school_id, code, title, term) values
  ('umich', 'EECS 280', 'Programming and Introductory Data Structures', '2026-fall');
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

---

## 已讨论但决定暂不做的：`school_editors`

曾考虑加一张 `(user_id, school_id)` 的编辑权限表，让课表编辑权按学校隔离。**结论是现在不做**——团队成员用 Supabase 后台或导入脚本时都走 service_role，绕过 RLS，这张表在有管理页之前是死代码。

等到要给第三个人录课、又不想再开数据库权限时再加。届时注意一个坑：查看策略目前是「只能看自己学校的」，如果只加写权限不改这条，会做出一个**能插入却看不见自己插入内容**的编辑角色。
