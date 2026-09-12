# PR #24 整合交接

日期：2026-09-12。当前状态见 [STATUS](../STATUS.md)，发布步骤见[部署手册](../runbooks/deploy.md)。

## 整合边界

以好友私聊分支 `2e3da19` 为起点合入原 `main` 的 `2b3cb4e`，不重写队友的提交。

- 保留主干的管理页、平台角色与审计、课程导入、资料保存修复和任务式文档导航。
- 保留队友的好友与私聊页面、举报、清理、可靠发送和 Realtime 去重。
- 仅两个文本冲突：环境交接保留双方信息并标注时点；数据库类型从完整 schema 重新生成。
- 队友新增的协作原则原文保存在 [collaboration.md](../agents/collaboration.md)，根 AGENTS 提炼必须遵守的摘要与按需入口，减少每次自动加载量。
- 历史 SQL 文件保持原样；完整迁移回归改为从目录自动发现全部 SQL，补上原联调列表遗漏的管理迁移和拉黑方向迁移。

## 验证与类型生成

两组完整链测试现在执行全部 19 条迁移，并验证管理权限、跨校隔离、可靠发送、举报保留和清理边界。额外核对好友列表双方看到的拉黑方向、管理入口与私聊未读同时显示，以及最终列权限下资料首次插入和后续更新。

类型生成使用 PGlite `0.5.8` 创建与集成测试一致的 Supabase Auth/角色桩，按文件名执行全部迁移；通过 Supabase 官方 `@supabase/postgrest-typegen@0.2.1` 的 `introspect`、`sortGeneratorMetadata` 和 `generateTypescript` 生成 `public` schema。参数保留 `detectOneToOneRelationships: true`、`postgrestVersion: "14.5"` 和 `defaultSchema: "public"`。生成工具临时安装，不增加应用依赖；没有手写或拼接数据库类型。生产实际对象仍须发布前核对并重新生成。

2026-09-12 最终验证依次通过：`npm test`（70 个文件、424 项）、`npm run build`、`npm run lint`、`npm run typecheck`。首次受限构建无法下载 Google 字体，允许网络后真实构建通过，未使用字体或服务模拟替代构建。PGlite 自动化通过不能替代真实 Supabase Realtime、真实邮箱、多浏览器和 PostgreSQL 多连接验收，Issue #19 不因本次代码合并关闭。

## 发布保护与恢复点

Vercel API 确认 GitHub 已连接，生产分支 `main`，现有生产提交 `2b3cb4e` / deployment `dpl_GRDM8T2uzj4VqswkCnHT1JVfochf`。因此本次新增 `vercel.json`，暂停 `main` 的 Git 自动部署；合并仅交付代码。预览仍启用。

生产数据库历史缺口未修复、缺失迁移未应用，未执行消息删除或启用清理调度。按部署手册逐步发布，保留现有 deployment 作为前端恢复点。原主干与队友分支均保留在 Git 历史中；回退代码不等于回滚数据库。
