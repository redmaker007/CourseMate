# 阶段 2 移动 API 代码审查记录

日期：2026-10-25；功能“网页包装成 App”，项目“课友网站”。当前进度以 [STATUS](../STATUS.md) 为准。此记录对应后端 Tickets 2–5；代码符合性通过，不等于真实账号、原生客户端、完整阶段联合验收或可上架。

## 固定范围和版本

- 工作树：`tmp/app-readiness`；分支 `feature/mobile-auth-api`。主工作区原有的其他功能改动未纳入或改写。
- 阶段起点：`bd1d557f5f26ec08cbda6b2c169ef463bd960bb9`，已确认是受审 HEAD 的祖先。
- 初审 HEAD：`67d22bddc8ac1b5f650cc97dcd735588cabf7e10`，四个实现提交：7334c01（课程）、67f3d6e（好友）、344f328（消息）、67d22bd（举报）。
- 范围：base 到工作区的 24 个阶段文件；显式核对 staged／unstaged／untracked，初审均为空，无删除／重命名，无遗漏新文件。包含移动 Route 的方法导出、共享课程适配器抽取、统一移动鉴权分发、各模块 HTTP 接口、测试和交接。
- 共同只读快照：本工作树忽略目录 `.next/cache/stage2-review-20261025/` 内的 manifest.md、snapshot.patch、context.md。保存完整差异、Spec／Tickets、24 路径内容 SHA-256 和 index 指纹。未上传源码副本。
- 初审 index SHA-256：`f91102a9b5c0848a2015f04ffbb9a1cd08f26cf08f5aeadfb2c673dbdcf26ec5`。两位 reviewer 返回后，主 agent 复核 24 文件及 index 未变化，工作树仍 clean，才开始修复。
- 修复提交：`a0da6294d82fd4c424144c5a6f43b7ac29278af8`。只改消息入口、其测试和消息交接三文件；fix.patch、fix-manifest.json 保存复查快照。两轴各自核对三文件新指纹及其余 21 文件未变后复查。此记录和 STATUS 是随后纯文档归档，不改变受审运行代码。

## Standards 独立审查

独立只读 reviewer `stage2_standards` 按 AGENTS、CONTRIBUTING、相关 ADR 与 Matt smell baseline 审查，未读取另一轴报告，未修改文件、提交或写外部记录。

初审发现 1 项 P2：消息入口接受大写 UUID，但 `src/features/messages/mobile-api.ts` 原第 79 行将原路径 conversationId 与 PostgreSQL 规范小写回执严格比较。含字母的大写会话 UUID 已正常执行发送，随后抛出 Invalid message receipt，被统一入口映射为 503；用户看到失败，通知调度被跳过。同 UUID 重试仍失败。相邻 clientMessageId 也需归一，否则发送回执与后续读取的 UUID 可能不一致。其余受审权限边界和错误处理未发现新增阻塞；无值得单独处理的 smell，不建议扩大重构。

针对性复查结论：通过，原 P2 已解决。校验后规范两种 UUID；保留发送者／会话回执验证、当前 RLS 过滤、sent_not_visible 无正文确认；通知使用规范会话 ID。新回归和交接覆盖大写输入、大小写混合重试、规范 RPC 参数、通知目标与 reconcile；无范围扩大。

## Spec 独立审查

独立只读 reviewer `stage2_spec` 读取完整当前 Spec、阶段目标与 Tickets 2–5 的验收，未读取 Standards 报告，未修改文件、提交或写外部记录。

初审发现 1 项 P2：上述 UUID 比较造成“已经写入却返回 503”，违反 Ticket 4 的“可靠读取、发送并恢复同步消息”及重试反馈要求。建议规范 conversationId 和 clientMessageId，并补含字母 UUID 回归。其余学校／关系权限、受控 RPC、bigint 精度、清除与已缓存 ID 重校验、举报证据隔离和交接未发现其他新增阻塞。

针对性复查结论：通过，原 P2 已解决，无新增发现。两种 UUID 归一覆盖发送、幂等重试、通知目标和 reconcile；原身份／目标验证及当前 RLS 完整保留，交接与代码一致。发布缺口与客户端联合验收仍保留，不能据本结论宣布完整功能或上架验收通过。

## 修复和验证证据

新增回归先失败：大写路径实际返回 503，断言要求 200；修复后 3 文件／34 项定向回归通过，包含移动消息、既有发送适配器和完整迁移链。测试 fixture 使用带 A–F 的 UUID，避免纯数字 UUID 掩盖大小写问题。

最终运行顺序：`npm test` 105 文件／768 项通过 → `npm run build` → `npm run lint` → `npm run typecheck` 依次通过。两位 reviewer 均只读复查，未独立重跑测试；上述结果由主 agent 本次实际执行。

Ticket 5 初次交付检查为 767 项；最终 768 项增加了阶段修复回归。本票生产构建的本地 HTTP 边界 7 项已通过，验证 Cookie 不能冒充 Bearer、错误授权、JSON 405／Allow 和 404、no-store、不设置 Cookie。未用虚构数据替代 SQL 权限证明：HTTP 测试用真实 SDK 的受控网络，权限由完整迁移链 PGlite 角色／RLS 验证。PGlite 不替代托管 PostgreSQL 多连接并发。

复查后的三文件 SHA-256（commit 前工作区字节；CRLF／LF 转换可能改变文本字节而不改变代码）：

| 文件 | SHA-256 |
|---|---|
| `docs/handoffs/mobile-messages-api.md` | `ec7b4f4793e89f7245eb69be684cc676eb91bb4c02e563112d906de41ad54a7d` |
| `src/features/messages/mobile-api.test.ts` | `9b967efc683c4c3548683a46c33e077a3d17d0b8c8e5d8609c8fda785c29e878` |
| `src/features/messages/mobile-api.ts` | `3cbe2f28a47f98a70478d00e3cae923c683cfca39b3f6c2d6fc26cfd68d20cce` |

## 真实验收和发布缺口

- 真实账号课程／好友／聊天／举报联调、iOS 页面和本机缓存、托管 PostgreSQL 多连接竞态、推送实际投递及运营处置均未验收。不得把这些待办勾为通过。
- [举报交接](mobile-reporting-api.md) 核实：课程消息举报尚不支持；没有已验证的内容过滤、举报审核工作台／及时响应安排或公开联系渠道；跨目标限流、证据保留依据／期限待讨论。已提供后台受控定位方法与依赖，未擅自实施跨功能治理或扩权。
- 消息物理删除后的旧 UUID 重放边界、永久注销正文／占位、证据不可变触发器／消息留存外键与本机副本，由 Ticket 6 开工界定并验证；本阶段不声称注销已实现。原生私信推送是 Ticket 7。
- Ticket 1 的首次验码失败分类遗留、双设备、首次资料补全、自然到期／异常与真机等延期项不因本阶段代码 review 通过而消失。
- 无新 SQL 迁移或依赖；未写远程业务数据、push、合并或部署。停止在阶段边界，不自动实施 Ticket 6。

## 交接入口

[课程](mobile-courses-api.md)、[好友](mobile-friends-api.md)、[消息](mobile-messages-api.md)、[举报及治理／删除依赖](mobile-reporting-api.md)。对应 Notion Spec、计划和 Tickets 中保存两轴结论、最终交付 SHA 与真实待验收项。
