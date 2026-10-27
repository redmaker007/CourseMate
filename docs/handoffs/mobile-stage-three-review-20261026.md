# 移动 API 阶段 3 审查记录

日期：2026-10-26。范围为 Ticket 6 永久注销和 Ticket 7 iOS 私信推送；代码符合性已完成双轴独立审查与修复复查，真实联调／客户端／上线验收未完成。未自动进入 Ticket 8。

## 版本与审查范围

- 项目：课友网站，功能：网页包装成 App；Spec `3ff7691d8baa81558566f14a35aa149d`，Tickets `3ff7691d8baa81c28bf8c440d69fb392`。
- Ticket 6 `4007691d8baa810085ebdd81d11b55be`；Ticket 7 `4007691d8baa8133b3b1eef2ae1727e0`。
- 分支 `feature/mobile-auth-api`，隔离工作树 `tmp/app-readiness`；阶段基线 `fe4b72cd37f4ba9cbefc16aa997b889a6227b7fe`。
- 初审 HEAD `f0fa83b14769f9e0faf1b8740b715ce2271d024f`：阶段提交 `3da1bbe`（注销）＋`f0fa83b`（APNs），28 个阶段路径，受审源码／index 无其他变化。
- 修复提交／最终代码 `cba0ee4af2c4ee9f6bb4d10d45a8d6587cea8065`，只改推送迁移、推送数据库回归和对应交接三文件。代码测试后本报告及状态／测试数量更新为后续纯文档提交，最终交付 HEAD 在 Notion 与 Git 记录。

开工沿用阶段 3 已确认的当前推理设置（此前推荐 High，未声称读取或切换实际模型参数）。用户选择举报默认清正文／身份、合法保留例外另定，一次事务注销失败回滚并支持回执恢复，以及 A：后端直接 APNs。原根工作区其他功能改动未纳入。

初审快照含 baseline→工作区 diff、完整 Spec／两票文本、28 路径工作区 SHA256／index blob；两个 reviewer 审查前后均核对通过。修复三文件另存 diff／SHA256，其余 25 个路径及 index 不变，两个 reviewer 分别核对通过。最终源码 manifest 覆盖修复后 28 路径，工作树 clean。

审查产物已保存到主工作区的 `tmp/app-stage-three-review-20261026-f0fa83b/`：`stage.diff`、`manifest.json`、`spec-and-tickets.md`、`fix-diff-and-hashes.txt`、`final-source-manifest.json`。从隔离工作树迁出的是本次生成的审查产物，未删除用户文件，未上传源码副本到 Notion。

## Standards 独立报告

初审发现 1 项 P2，未发现其他确认的越权删除、密钥泄露或 RPC 授权遗漏。

`202610260002_mobile_push.sql` 原注册函数无条件删除安装全部任务。同账号、会话、安装、token／环境启动确认或 PUT 重试，也会永久删除 pending／retry 通知，恢复 worker 无法补救。独立内存 PGlite 重放完整迁移链复现：新私信产生一个 pending → 同绑定 register 成功 → 队列变空。依据为既有幂等／错误恢复和 Ponytail 防数据损失要求，非启发式重构建议。

修复改为 `ON CONFLICT DO UPDATE WHERE` 比较账号、会话、token 和环境，只有实际变化才更新并 RETURNING 安装 ID；仅实际改绑清任务。相同绑定返回 registered 并保留待发／待重试任务。原账号锁、唯一约束、冲突行锁、真实改绑清理和旧租约失效保持。

针对性复查通过，原 P2 解决，无新增实质问题。Standards reviewer 核对修复三文件 SHA256 及其他 25 路径未变；实际执行了初审数据库复现，复查采用静态／指纹检查，未重跑全量检查。不得将主 agent 的测试描述为该 reviewer 独立执行。

## Spec 独立报告

初审无确认的缺失、错误实现或范围外变化。注销覆盖本人正文／身份、相关举报、Auth／设备及事务回执；推送覆盖资格复验、同账号会话绑定、租约重试和换号解绑。前端交接包含缓存恢复、通知去重、冷启动及账号／权限复验，未把外部客户端待办写成完成。

Spec reviewer 实际重跑初审定向 5 文件／36 项（注销 SQL、推送 SQL、注销 HTTP、APNs 本地 HTTP/2、dispatch），通过；未阅读另一轴报告。对新增幂等修复单独核对三文件和原 25 路径指纹，并实际重跑推送 SQL、移动 HTTP、dispatch 共 3 文件／35 项，通过，无新增 Spec 发现。

## 本次验证证据

- Ticket 7 初版全量 110 文件／805 项通过 → build → lint → typecheck 通过；修复了初次 build 暴露的环境字面量类型推导问题。
- 本地生产 HTTP 10 项通过：设备 PUT／DELETE／方法／凭据，退出无凭据，恢复入口秘密／Cookie／方法／空体／无配置，JSON／no-store／无 Set-Cookie。首次 HTTP 检查发现 Next 空 POST 仍有空流导致误报 400，修正并补回归，重建后复查通过；未发送真实通知或删除数据。
- 审查 P2 新增回归先红：1 失败／13 通过；修复后推送／注销／网页推送三文件 30 项通过，覆盖 pending／retry 保留和真实 token 轮换清理。
- 修复后最终严格顺序：`npm test` 110 文件／806 项 → `npm run build` → `npm run lint` → `npm run typecheck` 全部通过。
- 迁移链完整 30 条；PGlite 实测权限、租约／重试、环境隔离、会话／关系资格、退出／换号、永久注销设备／队列级联。APNs 发送器使用真实本地 HTTP/2 与临时 P-256 密钥验证 ES256 和响应分类；并非真实 Apple 接受结果。
- 修改文档相对链接检查 77 项，无缺失；源码修复提交前 `git diff --check` 通过。生成的 database.ts 未手改，目标库迁移后仍须 CLI 重新生成。

## 仍待验收与发布条件

1. Apple 会员／Bundle ID／推送凭据、真实 APNs、iPhone 授权／拒绝、前后台／冷启动／点击、离线／在途通知和账号／设备隔离。
2. 目标托管 Auth／SMTP／Storage 内部结构和 session_id／not_after，以及 PostgreSQL 多连接领取、改绑、注销和发送竞态；简化 fixture 不代替这些结果。
3. 原生／网页缓存清理、通知清除、明确账号失效及未知注销结果恢复；具体合法保留案件范围／依据／期限和外部日志／备份由负责人核实。
4. 先应用完整迁移并重新生成类型，再发布依赖应用；配置受控恢复调度并监控积压。未接 cron 不能把 after 当成可靠崩溃恢复保证。
5. APNs 接受不等于到达；未知网络结果可能重复提示，已在途／已展示通知不能保证撤回；expiration=0 时不可达设备可能无系统提示，消息仍从正常接口同步。

Ticket 1 原延期／首次验码分类遗留、其他既有发布治理缺口不因阶段 3 审查自动解决。本次无真实 Apple 凭据、APNs 发送、远程迁移／账号删除、购买、线上 cron、push／合并／部署。阶段 3 后端代码符合性通过，不等于原生客户端完成或 App 可直接上架。
