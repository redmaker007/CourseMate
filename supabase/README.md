# Supabase

数据库 schema、迁移、RLS、Auth 配置与邮件模板位于本目录。职责与审核范围见 [CODEOWNERS](../.github/CODEOWNERS) 和[协作约定](../CONTRIBUTING.md)。

## 入口

- 当前交付和线上迁移状态：[STATUS.md](../docs/STATUS.md)。
- 应用迁移、Auth Hook、SMTP、模板、OTP 参数和学校启用：[新建 Supabase 项目](../docs/runbooks/new-supabase-project.md)。
- 管理页初始化、角色与日常运营：[管理页与平台角色](../docs/runbooks/platform-admin.md)。
- 课程目录与学期课程：[录入课程](../docs/runbooks/seed-courses.md)。

## 文件与模型

- `migrations/`：按文件名顺序执行，只增不改；已进入 main 的迁移用新迁移修正。
- `preflight/`：迁移前只读检查；`seeds/`：受控测试数据及清理说明。
- `config.toml` / `templates/email-otp.html`：Auth 配置与六位 OTP 模板；托管后台配置不会随 Git push 自动应用。
- 身份与资料分存于 `member_accounts` / `profiles`；课程目录与学期课程分存于 `course_catalog` / `courses`。
- 课程和私聊共用 `conversations` / `conversation_members` / `messages`；旧 `groups` / `group_members` 已被迁移取代。

## 必须保留的边界

- 用户可写表必须启用并验证 RLS；学校精确域名规则同时由网站服务端与 Before User Created Hook 执行。
- `service_role` 绕过 RLS，不入库、不进入日志或浏览器；身份与权限不能信任客户端输入。
- 函数执行权显式从 `public, anon, authenticated` 收回，再按用途授权；内部辅助函数不授予客户端。
- 调整表或列权限时核对应用读写，并运行覆盖完整迁移链路的集成测试；`course-catalog-integration.test.ts` 与 `platform-admin.test.ts` 包含此类验证。
- 生成类型位于 `src/types/database.ts`；临时类型及待重新生成状态只在当前状态页记录。
