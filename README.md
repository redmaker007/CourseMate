# CourseMate 课友

非官方的课程社交平台，解决大课环境下学生互相不认识的问题。按课号找到同课同学、自动拉群、分享笔记、找学习搭子。

## 技术栈

| | |
|---|---|
| 框架 | Next.js 16（App Router）+ TypeScript |
| 样式 | Tailwind CSS v4 |
| 后端 | Supabase — Postgres / Auth / Storage / Realtime |
| 托管 | Vercel |

## 起步

```bash
npm install
cp .env.example .env.local   # 填入 Supabase 项目的 URL 和 anon key
npm run dev
```

打开 http://localhost:3000

## 现状

骨架已搭好，功能还没开始写。已经就位的：

- Next.js + TypeScript + Tailwind 脚手架
- Supabase 客户端三件套（浏览器端 / 服务端 / proxy 里的 session 刷新）
- `src/proxy.ts` 路由保护（未登录挡在受保护路由外）
- 学校邮箱域名白名单的前端部分
- CODEOWNERS 与协作约定

## MVP 范围（P0）

- [ ] 学校邮箱注册验证、登录登出、密码找回
- [ ] 用户资料（昵称、学校、专业、年级）
- [ ] 课程搜索 / 创建 / 加入退出
- [ ] 加入课程后自动建群、入群
- [ ] 群聊（Supabase Realtime）——不做已读回执、@提醒、图片消息

P1（MVP 稳定后）：学习搭子匹配、笔记上传共享、举报与内容审核（**举报机制必须在笔记功能上线前就位**）。

## 待定

- 首批试点学校（威斯康星 / 密歇根）
- 是否做中国留学生定位与双语 UI（决定了要不要引入 next-intl）

## 文档

- [CONTRIBUTING.md](CONTRIBUTING.md) — 分工、目录约定、分支与 PR 流程
- [supabase/README.md](supabase/README.md) — schema、RLS 与安全底线
