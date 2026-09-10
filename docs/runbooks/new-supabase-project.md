# Runbook：新建 Supabase 项目

> 适用于任何一个新的 Supabase 项目，包括将来的生产环境。
>
> 相关：[部署](./deploy.md) · [本地开发](./local-development.md) · [环境交接](../handoffs/environment-and-deployment.md)

⚠️ **跑完 SQL 只完成了一半。** 下面 2–5 步都是后台配置，代码和 migration 里都看不到，漏掉任何一步系统都会以危险或无声的方式失败。

## 1. 应用 migration

把 `supabase/migrations/` 下的 SQL 按文件名顺序贴进后台 SQL Editor 执行，**一次一个文件**。不需要 Docker，也不需要 CLI。

⚠️ **SQL Editor 不会把一个文件当作一个事务执行。** 2026-09-10 应用统一会话 migration 时实测：

- 文件里的 `begin; … commit;` 不起作用，每条语句各自提交
- **遇到错误不会停**，报错之后的语句照样执行，最后只报告一个错误
- 跨语句使用的临时表（`create temp table … on commit drop`）一建完就消失

所以「中途失败会整体回滚」在 SQL Editor 里不成立，「校验失败就中止」这种防护也拦不住后面的破坏性语句——那次校验块报错了，但它身后删旧表的语句照样执行了。执行后**只要看到任何报错，先别跑下一个文件**，把线上当前状态查清楚再说。

写新 migration 时：

- 不要跨语句使用临时表
- 不要依赖「前面的校验失败会阻止后面的删除」
- 需要真正原子执行时，改用直连数据库的方式（`psql --single-transaction`，或 `supabase db push`）。注意线上的迁移记录表目前是空的——之前的 migration 都是手工贴进 SQL Editor 的——直接 `db push` 会从第一个文件重跑，需要先用 `supabase migration repair` 标记已应用的版本

### 收回函数执行权要写全

Supabase 会通过 default privileges 把 public schema 里**新函数的执行权单独授予 `anon` 和 `authenticated`**。只写 `revoke execute on function … from public` 收不回这两份单独授权，本意受限的函数会对未登录用户开放。

`202609100005` 已经收回了这个默认值，但写新函数时仍然要写全，不要依赖那一次修复：

```sql
revoke execute on function public.xxx(uuid) from public, anon, authenticated;
grant execute on function public.xxx(uuid) to authenticated;  -- 按需
```

只在其他 `security definer` 函数内部调用的辅助函数，**不要授予任何客户端角色**。它们以函数属主身份执行，不需要调用者有执行权。

## 2. 注册 Auth Hook ← 最危险的一步

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

## 3. 配置自定义 SMTP

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

## 4. 替换邮件模板 ← 第二危险的一步

Supabase 默认模板发的是 `{{ .ConfirmationURL }}`（魔法链接），而本项目要的是六位验证码。**不换模板，用户收到的是一个链接，验证码框永远填不出东西。**

**Authentication → Emails → Email Templates**，`Magic Link` 和 `Confirm signup` 两个模板都要改，内容用 `supabase/templates/email-otp.html`（关键是里面的 `{{ .Token }}`），主题：

```
CourseMate 登录验证码 / Sign-in code
```

## 5. 数值设置

- **Authentication → Sign In / Providers → Email**：OTP Length = `6`，OTP Expiration = `600`
- **Authentication → Rate Limits**：每小时邮件数默认 2，测试期调到 30 左右

## 6. 开启学校

`schools` 表所有记录默认 `enabled = false`，不开启则**任何人都注册不了**。这是预期行为，不是 bug。

```sql
update public.schools set enabled = true where id = 'umich';
```

**不要把开启学校的语句写进 migration 提交**，除非正式试点学校已经定了。
