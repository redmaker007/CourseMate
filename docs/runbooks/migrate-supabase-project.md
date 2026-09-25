# Runbook：把数据库搬到另一个 Supabase 项目

> 适用于已有真实数据、要整体搬到新项目（换区域、换组织）的场景。全新空库看[新建 Supabase 项目](./new-supabase-project.md)。
>
> 相关：[部署](./deploy.md) · 首次实践记录（2026-09-25，us-west-2 → us-east-2）见 [STATUS](../STATUS.md)

⚠️ **`dump` 与导入只搬走 `auth` 与 `public` 的结构和数据。** Auth 后台设置、迁移历史表都不在里面，而且新库的出厂授权会让 `anon` 多出大量函数执行权（第 4 步）。这三件事漏掉任何一件，网站表面正常，权限或后续迁移却是错的。

## 0. 准备

- Docker Desktop 已启动（`supabase db dump` 依赖它）；不要 `npm i -g supabase`，用 `npx supabase`。
- 两个项目各重置一次数据库密码（只含字母和数字，免去 percent-encoding）。重置不影响网站，前端用的是 publishable / anon key。
- 连接串用 **Session pooler**（域名 `*.pooler.supabase.com`，端口 5432，用户名 `postgres.<ref>`）。不要用 `db.<ref>.supabase.co` 直连，免费版直连只有 IPv6。
- 连接串与密码只放当前窗口的环境变量，不写文件、不提交。`$env:` 只在当前 PowerShell 窗口有效，新开窗口要重设；报 `Missing value for flag --db-url` 就是这个原因。
- 迁移期间让网站停止写入。**dump 之后写入旧库的数据不会带过去。**
- 确认旧库 Storage 没有文件、没有 Edge Functions；有的话需要另行迁移。

## 1. 导出（旧库）

```powershell
npx supabase db dump --db-url $env:OLD -f roles.sql --role-only
npx supabase db dump --db-url $env:OLD -f schema.sql
npx supabase db dump --db-url $env:OLD -f data.sql --use-copy --data-only
```

三个文件都应非空。它们含用户数据，放在仓库外。

## 2. 导入前修 dump

新库的 `postgres` 角色不是超级用户，下面两处会让整个事务失败并回滚（新库不会留下半截数据）：

- `roles.sql`：删掉 `GRANT SET ON PARAMETER "log_min_messages" TO ...` 一行（平台自带，报 `permission denied for parameter`）。
- `data.sql`：删掉 `storage.*` 的所有 `COPY` 块（报 `permission denied for table buckets_vectors`），前提是第 0 步确认 Storage 为空。

## 3. 导入（新库）

本机没有 psql 17 时用 Docker。**不要用 `sh -c '…含双引号…'`**：PowerShell 5.1 会吃掉内嵌的双引号，命令被拆开后 psql 会连本地 socket。把命令写进 LF 换行的脚本再执行：

```powershell
# replica.sql 内容：SET session_replication_role = replica;
# run.sh 内容：psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --file replica.sql --file data.sql --dbname "$PGURL"
docker run --rm -e "PGURL=$env:NEW" -v "${PWD}:/work" -w /work postgres:17 sh run.sh
```

单事务：出错整体回滚，读报错、修正后重跑。末尾出现 `RESET` 且没有 `ERROR` 才算成功。

## 4. 恢复函数与表授权（必做）

`schema.sql` 里带着旧库每个对象的授权记录，但新库建对象时会**单独**授予 `anon` 与 `authenticated` 执行 / 表权限，dump 里的 `REVOKE ... FROM PUBLIC` 清不掉这两份（和[新建项目手册](./new-supabase-project.md)里「收回函数执行权要写全」同一个原因）。实测导入后 `anon` 能执行 69 个 public 函数中的绝大多数。

做法：先清空，再按 dump 里的记录重放，最后把默认授权改回来。下面从 `schema.sql` 生成脚本，读完再执行：

```powershell
$all = Get-Content schema.sql -Encoding UTF8
$grants = $all | Where-Object { $_ -match '^GRANT .+ ON (FUNCTION|TABLE|SEQUENCE) "public"\.' -and $_ -match ' TO "(anon|authenticated)";$' }
@(
  'begin;',
  'revoke all on all functions in schema public from anon, authenticated;',
  'revoke all on all tables in schema public from anon, authenticated;',
  'revoke all on all sequences in schema public from anon, authenticated;'
) + $grants + @(
  'alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;',
  'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;',
  'alter default privileges for role postgres revoke all on functions from anon, authenticated;',
  'alter default privileges for role postgres revoke all on tables from anon, authenticated;',
  'commit;'
) | Set-Content fix_grants.sql
```

在新库执行 `fix_grants.sql`（SQL Editor 或 `psql --single-transaction`）。脚本先收紧再放开，中途出错只会更严，可以整体重跑。复查：

```sql
-- anon 只应剩登录前必需的函数
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
```

表与序列权限对照 `schema.sql` 的 `GRANT` 记录。

## 5. 核对数据

在**两个库**分别执行，结果应逐行一致：

```sql
select table_schema, table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as rows
from information_schema.tables
where table_schema in ('public','auth') and table_type = 'BASE TABLE' order by 1, 2;

select * from pg_publication_tables where pubname = 'supabase_realtime';   -- 聊天依赖，应含 messages
select count(*) from pg_policies where schemaname = 'public';
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
```

Realtime 表对不上时补 `alter publication supabase_realtime add table public.<表名>;`。

## 6. 重配 Auth 后台项

这些是项目设置，不在 dump 里，逐项按[新建项目手册](./new-supabase-project.md)第 2–5 步：**Before User Created Hook（最危险，配完必须用三类非法邮箱实测都返回 403）**、自定义 SMTP、`Magic Link` 与 `Confirm signup` 两个邮件模板、OTP 长度与有效期、限流、**Access token expiry time 设为 900 秒**（代码本地验证令牌，这个值是撤销窗口的上限，见 [ADR-0009](../adr/0009-verify-access-token-locally.md)），另外要设 Site URL 与 Redirect URLs。`schools.enabled` 是数据，已随 dump 迁移，不用重开。

新项目的 JWT 密钥不同，**所有用户要重新登录一次**。

## 7. 补迁移历史表

`supabase_migrations` 不在 dump 里，新库没有迁移历史，`db push` 会从第一条重跑。用仓库里全部迁移的版本号登记为已应用（在最新 `main` 上执行，先确认库结构确实对应这些迁移）：

```powershell
$v = (Get-ChildItem supabase\migrations -Filter *.sql | ForEach-Object { $_.Name -replace '_.*$','' } | Sort-Object)
npx supabase migration repair --status applied @v --db-url $env:NEW
npx supabase db push --dry-run --db-url $env:NEW   # 应显示 Remote database is up to date
```

## 8. 切换前端

- Vercel 的 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 换成新项目的，**类型选 Config，不能是 Secret**（见[部署手册](./deploy.md)）。key 的类型跟旧项目保持一致（本项目用 `sb_publishable_…`）。Production 与 Preview 都要改，`.env.local` 同理。
- 重新构建部署，取消「Use existing Build Cache」：`NEXT_PUBLIC_*` 是构建时写进产物的，旧值可能被缓存带进去。
- 部署后不能只看页面能不能打开。前端产物里不一定能搜到项目地址，用新项目日志确认请求落在新库：登录、发消息各做一次，查 `edge_logs` 里有没有 `/auth/v1/verify`、`/rest/v1/rpc/send_conversation_message` 等请求，并留意 4xx。
- 回滚：把 Vercel 的 Production 变量改回旧项目并重新部署。切换之后新库里的写入不会回到旧库。

## 9. 收尾

- 再重置一次两个数据库密码（连接串曾出现在会话或终端里）。
- 删除本地 `roles.sql`、`schema.sql`、`data.sql`、`fix_grants.sql`（含用户数据）。
- 旧项目先保留几天当快照，新项目稳定后再删，然后把新项目改回原名。
- 免费版没有平台备份，见 [STATUS](../STATUS.md)。
