# 私聊消息安全清理交接

Issue #20 增加了“双方都清除后再保留 720 小时”的物理清理能力。本次只提交数据库能力和受控运维入口，不创建定时任务，也不会连接线上环境执行删除。

## 规则和数据流

1. 每次成员把清除位置向前推进，数据库都会在 `direct_message_clear_ranges` 记录这次新增覆盖的消息范围和时间；重复清除同一位置不会重置时间。
2. 某条私聊消息同时落入双方的清除范围时，`direct_message_cleanup_eligibility` 才记录它的起算时间，取双方相关清除时间中较晚的一个。
3. `preview_direct_message_cleanup` 按起算时间和消息 ID 稳定排序，只返回已经完整经过 720 小时、没有举报保留、仍属于有效双方私聊的候选消息。
4. `run_direct_message_cleanup` 用同一套候选规则重新检查并锁定有限批次后删除；消息删除不会删除会话、私聊配对、成员关系或好友关系。
5. 每次预览和执行都会写入 `direct_message_cleanup_runs`；执行失败时该批删除回滚，并留下失败原因。

这里使用严格的 `720 hours`，而不是 PostgreSQL 的 `30 days` 日历间隔。后者跨夏令时切换时可能只经过 719 小时，导致提前清理。

## 权限边界

- 用户只能调用原有的 `clear_direct_conversation`，不能读取内部清除范围、候选表或审计表。
- 预览和执行 RPC 只授予 `service_role`；候选规则函数本身不对任何 API 角色开放。
- 消息举报会在 `report_source_retention.message_id` 上建立真实外键保留。即使清理和举报同时发生，数据库也不会删除已经进入举报证据链的消息。

## 安全运行方式

先在受控运维环境提供 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。不要把 service-role key 放入浏览器、客户端包、日志或仓库。

默认命令只做 dry-run：

```powershell
npm run cleanup:direct-messages -- --batch-size=100
```

预览可传固定时间，方便复核边界；这不会改变真正执行时使用的数据库时钟：

```powershell
npm run cleanup:direct-messages -- --batch-size=100 --as-of=2026-09-11T00:00:00Z
```

确认预览出的 ID 后，真正执行必须同时提供两个显式参数：

```powershell
npm run cleanup:direct-messages -- --execute --confirm=DELETE_DIRECT_MESSAGES --batch-size=100
```

执行模式不接受 `--as-of`，避免操作者伪造未来时间绕过保留期。重复执行是安全的：已删除的消息不会再次出现，每次只处理最多 1000 条。

## 上线和调度状态

- 当前 migration 只存在于代码仓库，是否已经应用到某个远端环境需要由部署记录确认。
- 当前没有自动调度。上线后应先用小批量 dry-run 对候选 ID、数量和查询计划进行人工复核，再单独决定使用哪种受控调度设施。
- 真实 PostgreSQL 的多连接并发验收仍未完成；本地 PGlite 已覆盖候选规则、锁定语句、举报外键、批次幂等和失败回滚，但不能替代真实数据库连接之间的竞争测试。

## 排查顺序

候选不符合预期时，先看 `direct_message_cleanup_runs` 的评估时间和候选 ID；再检查双方的 `direct_message_clear_ranges` 是否都覆盖目标消息；然后检查 `direct_message_cleanup_eligibility.eligible_since` 和举报保留行。执行失败则先看审计里的 `error_details`，不要直接绕过规则手工删除消息。
