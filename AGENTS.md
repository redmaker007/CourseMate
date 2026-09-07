<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue tracker

项目使用 GitHub Issues 管理 Spec 和 Tickets。详见 `docs/agents/issue-tracker.md`。

### Triage labels

项目使用默认的 mattpocock/skills triage 标签。详见 `docs/agents/triage-labels.md`。

### Domain docs

项目采用单上下文结构：根目录 `CONTEXT.md` 和 `docs/adr/`。详见 `docs/agents/domain.md`。
