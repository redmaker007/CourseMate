# Runbook：管理页与平台角色

> 设计理由见 [ADR-0005](../adr/0005-platform-roles-and-admin-functions.md)。

## 谁能做什么

| | 普通成员 | 管理员 | 所有者 |
|---|---|---|---|
| 进入 `/admin` | ❌ 看到 404 | ✅ | ✅ |
| 导入课表、增改单门课、重新生成当前学期课程 | ❌ | ✅ | ✅ |
| 切换学期 | ❌ | ✅ | ✅ |
| 切换测试学校（用自己的账号体验另一所学校） | ❌ | ✅ | ✅ |
| 查看学校、团队、操作记录 | ❌ | ✅ | ✅ |
| 新建学校、改名、开放 / 关闭、增删邮箱域名 | ❌ | ❌ | ✅ |
| 任命 / 撤销管理员 | ❌ | ❌ | ✅ |

所有者只有一位。大厅页头的「管理」按钮只对管理员和所有者显示。

页面上藏起表单只是为了好用，**真正的限制在数据库函数里**：绕过页面直接调用同样会被拒。

---

## 第一次启用

### 1. 应用 migration

在 SQL Editor 里执行 `supabase/migrations/202609100006_platform_admin.sql`。

SQL Editor 不按事务执行（见 [新建 Supabase 项目](./new-supabase-project.md)），执行后跑一遍下面的检查。应当返回 **14 行，两列全部为 `true`**：

```sql
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as 登录可用,
       not has_function_privilege('anon', p.oid, 'execute') as 未登录不可用
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'admin\_%' or p.proname = 'current_platform_role')
order by 1;
```

### 2. 指定所有者（只做一次）

先用学校邮箱在网站上登录一次、填好资料，然后在 SQL Editor 里执行（把邮箱换成自己的）：

```sql
insert into public.platform_roles (user_id, role)
select members.user_id, 'owner'
from auth.users users
join public.member_accounts members on members.user_id = users.id
where lower(users.email) = lower('你的学校邮箱');
```

提示插入 1 行才算成功。插入 0 行说明邮箱写错了，或者这个邮箱还没登录过。

刷新大厅，页头出现「管理」按钮。

### 3. 任命管理员

对方先用学校邮箱登录一次。然后在 `/admin` →「管理员」里填对方的学校邮箱，点「任命为管理员」。对方刷新大厅就能看到入口。

### 4. 收回协作者的 Supabase 后台权限（建议）

管理页跑通之后，协作者的日常工作已经不需要进 Supabase 后台。Supabase 免费版没有只读角色，后台成员能看到 service_role key、关闭 RLS、读取全部用户邮箱。

在 Supabase Dashboard → Organization → Team 里移除对方。改数据库结构（跑 migration）仍由主开发者在 SQL Editor 里执行。

---

## 日常操作

### 导入课表

「课程录入」→ 选学校 → 选择 Google Sheet 导出的 `.xlsx`（文件 → 下载 → Microsoft Excel）。

页面先在浏览器里解析文件并给出报告，内容与命令行脚本的预演一致——两者共用同一个解析器。报告怎么读见 [录入课程](./seed-courses.md)的「先预演」一节。核对无误后勾选确认，点「写入」。

- 文件**不上传到服务器**：在浏览器里解析，只把解析结果分批发送。原因是 Server Action 默认只收 1MB 请求体，Vercel 的硬上限是 4.5MB，整份课表可能超过。
- 每 200 门一批。任一批出错会停下并说明已写入多少。写入是覆盖式的，修正后重新导入整份文件即可。
- 写完目录后自动生成当前学期的课程。

### 切换学期

「学校与学期」→ 对应学校 → 填新学期（格式 `2027-spring`，季节为 spring / summer / fall / winter），再输入一遍确认。

- 本校所有旧学期的课程群归档成只读，历史消息与成员保留。
- 立即按目录建出新学期的课程，**不用重导课表**。
- 切错了可以切回去：原学期的课程群会恢复。新学期已经建出的空课程会留着，无害。

### 切换测试学校

用自己的账号体验另一所学校的课程、好友和私聊。设计理由见 [ADR-0006](../adr/0006-admin-cross-school-testing.md)。

「切换测试学校」→ 选一所开放中的学校 →「进入测试学校」。之后每个页面顶部都有黄色横幅，显示当前测试学校和账号归属，点「返回本校」即退出。

- 登录仍用自己的学校邮箱，不受影响。
- 对这个账号的**所有设备同时生效**。
- **测试写入的是真实数据**：本地、预览与生产目前共用一个数据库，发出的课程消息、好友申请会出现在该校真实学生面前。能用测试课程时尽量用测试课程。
- 返回本校后：该校课程群看不到也发不了（选课记录保留，再次进入即恢复）；和该校成员的私聊历史还能看，但**双方都不能再发新消息**。
- 撤销管理员身份、或该校被关闭时，测试状态自动结束。
- 两位管理员都切到同一所学校，就能互相测试加好友和私聊。

### 增改单门课

「课程录入」→「新增或修改单门课」。课号相同就是修改，会同时更新目录和当前学期的课程名称。课号格式为「学科 + 编号」，如 `EECS 280`、`ACCT I S 100`。

### 学校与域名（仅所有者）

- 新学校默认不开放。先添加邮箱域名、设置当前学期，再开放。
- 开放中的学校删不掉最后一个域名，要先关闭学校。
- 关闭学校后该校邮箱不能再登录；**已登录的成员不会被踢出**，但退出后就进不来了。
- 域名精确匹配，子域名不继承（`med.umich.edu` 需要单独添加）。

---

## 操作记录

每次操作都写进 `admin_audit_log`，管理页显示最近 50 条，时间统一是 UTC。要看更早的记录，在 SQL Editor 里查：

```sql
select created_at, action, target, details
from public.admin_audit_log
order by id desc
limit 200;
```

## 常见问题

- **任命时提示「找不到这个邮箱对应的成员」**：对方还没用这个学校邮箱登录过。
- **页头没有「管理」按钮**：先刷新；仍没有就在 SQL Editor 里查 `select * from public.platform_roles;`。
- **管理页显示 404**：没有身份，或者身份读取失败（例如 migration 没应用）。出错时按没有身份处理是刻意的。
- **撤销所有者、转让所有权**：网站上做不了，在 SQL Editor 里改 `platform_roles`。

## 命令行导入脚本还有用吗

有，但只在管理页用不了的时候：新建 Supabase 项目、还没有任何管理员。见 [录入课程](./seed-courses.md)。
