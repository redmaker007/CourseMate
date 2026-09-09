# Runbook：录入课程

> 课程数据的授权申请见 [request-course-data.md](./request-course-data.md)。
>
> 为什么不逆向学校的公开课程接口，见 [ADR-0002](../adr/0002-do-not-reverse-engineer-university-course-search.md)。

### 录入课程的注意事项

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

### 已讨论但决定暂不做的：`school_editors`

曾考虑加一张 `(user_id, school_id)` 的编辑权限表，让课表编辑权按学校隔离。**结论是现在不做**——团队成员用 Supabase 后台录入时 service_role 绕过 RLS，这张表在有管理页之前是死代码。

等到要给第三个人录课、又不想再开数据库权限时再加。届时注意一个坑：查看策略目前是「只能看自己学校的课」，如果只加写权限不改这条，会做出一个**能插入却看不见自己插入内容**的编辑角色。
