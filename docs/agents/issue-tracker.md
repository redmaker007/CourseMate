# Issue Tracker：GitHub

本项目的 Spec 和 Tickets 使用 GitHub Issues，通过 `gh` CLI 操作。

## 约定

- 创建：`gh issue create`
- 查看：`gh issue view <number> --comments`
- 列出：`gh issue list`
- 评论：`gh issue comment <number>`
- 添加或移除标签：`gh issue edit`
- 关闭：`gh issue close`
- 仓库从当前 Git remote 自动确定
- PR 不作为 triage 请求入口

当 skill 要求“发布到 issue tracker”时，创建 GitHub Issue。
当 skill 要求“读取 ticket”时，读取对应 GitHub Issue 及评论。

优先使用 GitHub 原生依赖关系记录 Blocked by；如果仓库不支持，则在 Issue 正文中记录 `Blocked by: #...`。
