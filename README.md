# CourseMate 课友

以学校邮箱为入口的非官方课程社交平台，帮助同校成员找到同课同学并在课程群中交流。

技术栈：Next.js 16 App Router、TypeScript、Tailwind CSS v4、Supabase（Postgres / Auth / Realtime），托管于 Vercel。

## 从这里开始

- 了解项目进度：[当前状态](docs/STATUS.md)。
- 开发或排障：[任务与代码索引](docs/README.md)；按任务选择文档，不需要通读所有交接。
- 找“操作手册”：见下方六个入口。
- 协作规则：[CONTRIBUTING.md](CONTRIBUTING.md)；业务术语：[CONTEXT.md](CONTEXT.md)。

## 操作手册

| 任务 | 手册 |
|---|---|
| 本地安装、环境变量、启动和验证顺序 | [本地开发](docs/runbooks/local-development.md) |
| Vercel 预览与生产部署 | [部署](docs/runbooks/deploy.md) |
| 数据库迁移、Auth Hook、SMTP 和 OTP 配置 | [新建 Supabase 项目](docs/runbooks/new-supabase-project.md) |
| 所有者与管理员、管理页日常操作 | [管理页与平台角色](docs/runbooks/platform-admin.md) |
| 课表预演、导入与当前学期课程生成 | [录入课程](docs/runbooks/seed-courses.md) |
| 向学校申请课程数据 | [申请课程数据授权](docs/runbooks/request-course-data.md) |

## 业务主线

学校邮箱验证码登录 → 创建成员账号 → 补全显示名称 → 搜索并加入当前学期课程 → 自动加入课程会话。

课程目录由管理流程录入，再生成带学期的课程；普通成员只能加入已有课程。课程会话和私聊共用会话数据模型，具体交付范围见当前状态页。
