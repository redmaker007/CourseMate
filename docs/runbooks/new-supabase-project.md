# Runbook：新建 Supabase 项目

> 适用于任何一个新的 Supabase 项目，包括将来的生产环境。
>
> 相关：[部署](./deploy.md) · [本地开发](./local-development.md) · [环境交接](../handoffs/environment-and-deployment.md)

⚠️ **跑完 SQL 只完成了一半。** 下面 2–5 步都是后台配置，代码和 migration 里都看不到，漏掉任何一步系统都会以危险或无声的方式失败。

## 1. 应用 migration

把 `supabase/migrations/` 下的 SQL 按文件名顺序贴进后台 SQL Editor 执行。不需要 Docker，也不需要 CLI。

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
