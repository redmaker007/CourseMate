<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 项目导航

CourseMate 是学校邮箱准入的课程社交平台；Next.js 16 + Supabase，代码按 `src/features/` 分模块。

- 首次接手：读 `CONTEXT.md`（术语）；需要项目现状时读 `docs/STATUS.md`。
- 实施或排障：按 `docs/README.md` 的任务表选择相关 ADR、模块代码与测试；操作手册入口在根 README。
- 已在当前上下文读过且未变化的内容不重复读取。不默认通读全部交接、操作手册或源码；先用 `rg` 定位，再按依赖扩大范围。用户明确要求全面阅读或审计时按要求执行。
- 当前进度只维护在 `docs/STATUS.md`；handoff 的状态、分支和测试结果是历史记录。改变业务行为前核对当前代码和相关 ADR，冲突必须说明。
- 测试、构建和部署结果只报告本次实际验证的内容；引用旧结果时注明来源与时点。

## 工作约定

- 文档与注释用中文。权限职责、PR 与审核规则见 `CONTRIBUTING.md` / `.github/CODEOWNERS`。
- `.env.local`、密钥、真实验证码与会话不进入提交或日志。生成目录、依赖与真实环境文件不作为默认阅读材料。
- 修改代码前遵守上方 Next.js 指引，只读所用 API 的相关本地文档。
- 完整代码验证顺序：`npm test` → `npm run build` → `npm run lint` → `npm run typecheck`；build 为 typecheck 生成必要类型。纯文档修改检查链接、路径和 diff；提交 / PR 前另遵守协作约定。
- 涉及认证、schema 或权限时，读对应 ADR、`supabase/README.md` 及必要操作手册，保留权限边界和完整迁移链路验证。

## 按需协作资料

GitHub Issue 操作：`docs/agents/issue-tracker.md`；triage 标签：`docs/agents/triage-labels.md`；领域文档维护：`docs/agents/domain.md`。仅在任务涉及这些流程时展开。
