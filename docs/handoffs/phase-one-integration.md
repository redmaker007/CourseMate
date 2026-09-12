# 第一阶段全链路联调交接

> 对应 Issue #19，核对日期：2026-09-11。
>
> 本文严格区分“本地自动化验证”和“托管环境实测”。本轮没有部署、远端 seed、生产消息删除或测试数据删除。

## 当前结论

第一阶段代码在本地已经形成一条连续链路：全部 16 条 migration 按时间顺序应用，两校各两个独立成员完成 TEST00 课程流程，同校成员完成发现、申请、接受、私聊、未读折叠、拉黑、举报、双方清除、受控清理、删除好友和重新添加。

这不能替代托管环境验收。真实邮箱登录、四个浏览器会话、Supabase Realtime 网络行为和真实 PostgreSQL 多连接竞争仍然没有实测，因此 Issue #19 不应关闭。

## 自动化验收矩阵

| 范围 | 本地结论 | 主要证据 |
|---|---|---|
| 全部 migration 组合 | 16 条 migration 按真实顺序应用成功，最终权限面仍关闭 | `supabase/migrations/phase-one-integration.test.ts` |
| 两校 TEST00 | `uw-madison`、`umich` 各两个成员独立完成加入、群消息、成员列表、隔离和退出 | `phase-one-integration.test.ts`、`supabase/seeds/issue-13-test00.test.ts` |
| onboarding 与越权 | 无 Profile 成员无法搜索/加入课程或使用社交入口；跨校、伪造成员 ID、普通成员建课被拒绝 | `phase-one-integration.test.ts`、`profile-onboarding.test.ts`、`course-flow.test.ts` |
| 好友生命周期 | 完整邮箱发现、申请、接受、备注、屏蔽、拉黑、解除、删除、重新添加和申请历史符合规则 | `phase-one-integration.test.ts`、`friendship-backend.test.ts` |
| 私聊与未读 | 首次附言成为消息；隐藏会话未读只进入隐藏计数；双方拉黑时均不能发送；恢复后复用同一会话 | `phase-one-integration.test.ts`、`friendship-backend.test.ts`、`src/features/messages/` 下测试 |
| Realtime 与降级 | `messages` 位于 Realtime publication；课程群与私聊组件覆盖订阅补查、按 ID 去重、页面聚焦补查、5 秒轮询和失败退避 | `phase-one-integration.test.ts`、`course-chat.test.tsx`、`use-direct-message-sync.test.tsx` |
| 安全渲染与长度 | 消息按纯文本展示并只识别 HTTP(S)；Profile、备注、申请、消息和举报说明的 Unicode 边界已有服务端/数据库/组件测试 | `safe-message-text.test.tsx` 及各 feature/migration 测试 |
| 举报与证据 | 举报人身份、目标可见性、不可变快照、去重和消息保留关系通过；普通成员不能读取证据表 | `reporting.test.ts`、`src/features/reporting/` 下测试 |
| 双方清除与物理清理 | 第一人清除不产生候选；第二人覆盖后从较晚时间起算严格 720 小时；举报消息不删除；执行集合与 dry-run 集合一致 | `phase-one-integration.test.ts`、`direct-message-cleanup.test.ts` |
| 有限批次与失败 | 确定顺序、批量上限、重复执行、失败回滚与审计通过 | `direct-message-cleanup.test.ts`、`direct-message-cleanup.test.mjs` |

## Spec #10 交付映射

| Ticket | 对应能力 | 实现提交 |
|---|---|---|
| #11 | 强制 Profile onboarding 与资料维护 | `d16736b` |
| #12 | 统一会话核心与课程群迁移 | `5717847` |
| #13 | 真实课程流程、课程群聊与两校 TEST00 | `62aaa10` |
| #14 | 好友发现、申请与关系状态后端 | `1441218` |
| #15 | 好友、申请、屏蔽与拉黑页面 | `d8642b2` |
| #16 | 私聊消息、未读、清除位置与同步后端 | `0ffa3a1` |
| #17 | 一对一聊天操作页面 | `0354065` |
| #18 | 行为举报与证据快照 | `e49adb3` |
| #20 | 双方清除后的安全物理清理 | `39f5d8b` |
| #19 | 最终本地联调、托管环境验收和交接 | 当前工作 |

完整学校课程数据库仍由外部课程数据模块提供。TEST00 只是联调夹具，不是正式课程数据，也没有硬编码进产品逻辑。

## 托管环境状态

- `npx supabase migration list --linked` 在 2026-09-11 只读查询时，只看到远端历史表登记 `202609050001` 和 `202609050002`。
- 旧交接记录显示，schema 曾通过 SQL Editor 手工应用并诊断到 `202609100005`。因为 SQL Editor 不会自动维护 Supabase migration 历史，两条记录并不矛盾，但也不能证明当前每个对象都正确。
- `202609110001`–`202609110005` 没有托管部署记录。本轮没有应用它们。
- 当前生产网站仍是 2026-09-10 部署的 #11–#14 版本；当前功能分支上的 #15–#20 没有部署。
- 生产 Realtime 行为、私聊清理调度、真实 PostgreSQL 多连接并发均未验证；清理调度保持关闭。

发布前不要直接执行 `db push`。先只读核对远端表、函数、策略、触发器、publication 和 migration 历史，再根据差异决定是修复历史记录还是应用缺失 migration，避免在已手工应用的对象上重复执行。

## 托管环境待验证清单

- [ ] 准备四个独立测试身份：两校各两个，不使用单一账号模拟多用户。邮箱和凭据只保存在受控位置，不写仓库、Issue 或日志。
- [ ] 四个身份分别完成真实 OTP 登录和强制 Profile；另用一个未完成 Profile 的会话验证直接数据库调用被拒绝。
- [ ] 核对并经明确批准后应用缺失 migration；重新生成数据库类型并部署当前功能分支。
- [ ] 通过网站完成两校 TEST00 加入、群聊、成员列表、退出与归档只读流程。
- [ ] 完成好友申请、拒绝/过期、接受、备注、屏蔽、拉黑、解除、删除和重新添加。
- [ ] 在四个真实浏览器会话中验证课程群和私聊 Realtime；断网后确认补查、去重、5 秒轮询与退避。
- [ ] 在真实 PostgreSQL 多连接下竞争执行发送消息、推进清除位置、新增举报和清理 dry-run/execute。
- [ ] 记录清理 dry-run 的精确消息 ID；未经单独批准不执行物理删除。
- [ ] 完成最终统一严格 code review。

## 测试数据与清理

TEST00 使用固定 ID：

- `13000000-0000-4000-8000-000000000001`：`uw-madison / TEST00 / 2026-fall`
- `13000000-0000-4000-8000-000000000002`：`umich / TEST00 / 2026-fall`

课程夹具只能使用 `supabase/seeds/issue-13-test00-cleanup.sql` 清理。脚本会先核对 ID、学校、课程代码、标题和学期，任何字段不一致都会拒绝删除。

真实测试身份尚未创建，所以目前没有可安全提交的账号清理 ID。创建身份后，应先在受控记录中保存四个用户 UUID 及其派生数据范围，再编写只接受这些精确 UUID 的清理事务；不得按邮箱、显示名称、`TEST%`、时间范围或通配符删除。

## 最终命令状态

2026-09-11 按 Ticket #19 的固定顺序完成：

1. `npm test`：通过，63 个测试文件、356 项测试。
2. `npm run build`：通过，Next.js 16.3.4 生产构建完成。
3. `npm run lint`：通过，无 ESLint 错误。
4. `npm run typecheck`：通过，无 TypeScript 错误。

开发过程中的单项测试不计入这次最终顺序；以上结果来自完成代码后的独立收尾运行。
