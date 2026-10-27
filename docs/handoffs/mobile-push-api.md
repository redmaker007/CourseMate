# iOS 私信推送与前端交接（Ticket 7）

日期：2026-10-26；本票起点 `3da1bbe`，阶段 3 基线 `fe4b72c`，分支 `feature/mobile-auth-api`。交付状态及阶段审查结论以 [STATUS](../STATUS.md) 为准。后端路径已实现，未部署；原生页面／通知接收和真机验收由客户端任务完成。

## 通道与所需条件

用户选择直接调用 Apple APNs。React Native + Expo 不变，客户端使用 `expo-notifications.getDevicePushTokenAsync()` 获取原生 iOS token，不能传 ExpoPushToken。仅私信；不增加课程群／好友申请原生推送。网页 VAPID 通知保持现状，订阅和去重记录独立。

需要团队自己的 Apple Developer Program 会员、App Bundle ID、Push Notifications capability、与构建匹配的签名／entitlement，以及服务端 APNs `.p8` 密钥、Key ID、Team ID。通常会员年费 99 美元，APNs 无额外按条发送费用，当地价格以 Apple 结算为准。发送与恢复调度消耗服务器资源，未核实套餐剩余额度或购买服务。Apple 会处理设备 token、发送者名称、接收账号及会话标识；不发送聊天正文，也不经过 Expo Push Service，应据此完善隐私说明。

依据：[Apple 会员](https://developer.apple.com/programs/whats-included/)、[APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)、[Expo 直接接 APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)。

## 设备接口

沿用 [移动认证](mobile-auth-api.md)：HTTPS、Bearer、JSON、16 KiB 上限、拒绝未知字段；网站 Cookie 不能代替凭据。响应 JSON、`private, no-store`，不设置 Cookie。

| 方法／路径 | 输入 | 输出 |
|---|---|---|
| `PUT /api/mobile/v1/push/device` | `installationId`、`deviceToken` 字符串 | 200 `registered`；400 `invalid_request`；401 凭据／`session_invalid`；403 准入／onboarding；409 `device_limit_reached`；503 暂不可用或未配置 APNs |
| `DELETE /api/mobile/v1/push/device` | `installationId` 字符串 | 200 `removed`，没有本人绑定也幂等成功；400 输入非法；401 无凭据；503 未确认解绑成功 |
| `POST /api/mobile/v1/auth/sign-out` | `{}`，原格式不变 | 先解绑本会话的所有原生设备，再撤销当前 Auth 会话；任一步失败为 503，不假报已退出 |

安装 ID 为本次安装随机生成并持久保存的 UUID，换账号沿用。token 是系统给出的 32–512 个十六进制字符且长度为偶数，不假定固定长度。不得上传收件人、发送者、正文、环境或 Bundle ID。虚构示例：

```json
{
  "installationId": "22222222-2222-4222-8222-222222222222",
  "deviceToken": "abababababababababababababababababababababababababababababababab"
}
```

绑定身份只来自经 Supabase 验证的 `auth.uid()`／JWT `session_id`，检查会话仍在 `auth.sessions`、未到 `not_after`、学校／成员／资料有效。每账号最多 10 个安装。普通角色不可读 token／任务表或任意触发发送；同账号／会话／token／环境的重复登记幂等保留 pending／retry 任务，仅实际改绑才删除旧任务，注册不是补发历史通知的入口。

DELETE 按当前 Bearer 的账号＋会话限制，可在资料／成员准入失效后解绑；旧账号不能删除已改绑给新账号的安装。解绑不清聊天缓存。暂时失败要锁定旧账号界面并保留受保护的恢复状态，不能先丢弃所有凭据而让退出无法重试。

## 前端生命周期

1. 使用开发构建或 TestFlight，不能以 Expo Go 代替推送验收。适时请求系统授权；拒绝仍可用所有核心课程／好友／聊天功能。
2. 登录、成员验证和 onboarding 完成后获取 token 并 PUT。启动、token 更新、重新授权／登录时确认绑定，不在每次页面刷新或每条消息时登记。
3. 回到前台时重查授权，关闭权限时用有效 Bearer＋安装 ID DELETE 解绑。
4. 切换账号先锁定旧页面、清除旧账号已展示通知及导航意图，再完成旧账号退出。新账号验证和安装改绑成功后才能按新账号打开通知；失败保持安全过渡并重试。
5. 主动退出仍保留并锁定本人离线缓存，联网重登同账号后才能读。永久注销沿用 [Ticket 6](mobile-account-deletion-api.md)，完成后删除本人凭据／缓存并清通知；设备及待发送任务随成员删除级联清理，回执／未知结果恢复规则不变。

## 通知与点击导航

标题为服务端读取的发送者当前显示名称，提示固定“发来一条消息”；无聊天正文、摘要、邮箱、头像 URL 或访问令牌。系统授权／专注模式／锁屏设置可能隐藏提示，不保证强制显示。虚构 payload：

```json
{
  "aps": { "alert": { "title": "同学", "body": "发来一条消息" }, "sound": "default" },
  "type": "direct_message",
  "recipientId": "33333333-3333-4333-8333-333333333333",
  "conversationId": "44444444-4444-4444-8444-444444444444",
  "notificationId": "11111111-1111-4111-8111-111111111111"
}
```

冷启动、后台恢复、前台收到、重复点击须按下列规则处理：

- 校验 type／字段并按 notificationId 去重。通知是导航提示，不能据此插入聊天消息或更新真实未读数。
- 未登录只暂存非敏感导航意图，登录／成员验证后再处理。当前账号不等于 recipientId 时禁止打开旧缓存，不自动换账号。
- 用当前账号 `GET /api/mobile/v1/conversations/{conversationId}` 重新确认权限；目标删除、无权或本人屏蔽时回到合适列表／专门页面。不能依通知绕过屏蔽，离线时标识不代表当前服务端授权。
- 聊天／未读以 [消息接口](mobile-messages-api.md) 为准；退出／换号清除系统通知及待执行导航意图。

## 数据流与失败恢复

消息落库触发事务队列，安装＋消息唯一；网页和移动私信共用原有消息表，用户不自报通知目标。发送确认后的既有 `after` 接缝尝试派发，不等待 APNs；原生队列和网页 push_dispatches 独立。

入队先由服务端根据私聊和消息发送者推导唯一接收者，按接收者 user_id 索引筛选候选设备，再逐项复验资格；不会为每条消息扫描全站设备。此处不信任客户端提交的接收者，也不省略后续会话／关系检查。

领取前重新检查消息未删且五分钟内、双方成员／学校／资料有效、有效好友／同校／无拉黑、收件人未屏蔽、本人清除游标和设备 Auth 会话。收件人、会话、名称由数据库推导，仅 service role 可领取和回写。

每批最多 5 项，`FOR UPDATE SKIP LOCKED`＋60 秒独立租约，APNs 请求 5 秒超时。网络错误、429／5xx 或过期 provider token 重试；最多领取 4 次，退避 15／60／120 秒，超过消息五分钟时效不补发。成功、永久失败或资格失效不重试。已完成任务七天后有界清理，只存状态和外键，无正文／姓名快照。

410 Unregistered／400 BadDeviceToken 清对应设备及任务；topic／provider 配置错误不误删设备。改绑移除旧任务，旧租约回执不会删除新账号设备。worker 崩溃或回写失败后由恢复调度重新领取，绝不为此重写聊天消息。

使用 Node 内置 HTTP/2、ES256，无新增依赖；同进程 provider JWT 缓存 25 分钟。sandbox／production 固定由服务端配置且分别领取。APNs ID／collapse ID 为稳定任务 UUID，客户端也要去重；超时未知结果可能导致重复提示，不能承诺严格一次投递。

`apns-expiration: 0` 禁止 Apple 为离线设备长期保存通知，减少退出／换号后旧通知延迟出现的风险；设备不可达可能没有系统提示，消息仍通过正常同步恢复。领取和 Apple 接受间有在途窗口，已接受／已展示的通知无法由后端撤回。客户端必须清通知并复查账号／权限，不承诺远程消除截图、已展示通知或离线副本。

## 配置与上线顺序

1. 目标测试库先应用完整迁移链，本票为第 30 条 `202610260002_mobile_push.sql`，包含 Ticket 6 迁移；再发布应用。PGlite 的简化 Auth fixture 不代替托管 Auth 验证。
2. 迁移后用 Supabase CLI 重新生成 database.ts 并核对。本票未手写生成类型，新增 RPC 使用窄调用端口；生成状态仍待办。
3. 按 `.env.example` 设置 service role 及 APNS_KEY_ID／TEAM_ID／BUNDLE_ID／PRIVATE_KEY／ENVIRONMENT。私钥允许多行或转义换行，仅服务端保存。缺项不假报可用；解绑／退出不依赖 APNs 密钥。TestFlight／App Store 用 production，开发构建以 aps-environment 为准。
4. 配置独立随机 MOBILE_PUSH_DISPATCH_SECRET（至少 32 字符），仅交给运维调度器。接通受控定时任务，例如每分钟调用一次恢复入口；高峰按实测积压提高频率。每调用最多 5 项，只有 after 无法保证进程中断恢复，发布前必须配置并监控定时任务。当前未创建 cron 或变更套餐，调度平台和费用仍需按真实环境核实。

   `POST /api/mobile/v1/internal/push-dispatch`

   Header：`Authorization: Bearer <MOBILE_PUSH_DISPATCH_SECRET>`，无 body／查询参数。200 `processed`＋claimed／sent／retry／invalid_token／failed／stale／unsettled 汇总；401 秘密不符；405 错误方法；503 未配置或初始化／领取失败。用户 Bearer／Cookie 无权调用，秘密不交客户端、不进 URL／日志。

5. 运维关注 failed／unsettled、重试、积压和调度存活；配置错误查环境／Bundle ID／key，不能重发聊天消息。HTTP 200 只说明本批处理，sent 只表示 APNs 接受，不等于用户已看到。
6. 回滚前停恢复调度，不删除历史迁移或任意丢队列；修复配置／调度后观察新消息，不重写原消息补通知。

## 验证及待办

本票审查修复后完整检查：110 文件／806 项测试、build、lint、typecheck 通过；首次 build 的环境字面量推导问题已修复。数据库重放 30 条迁移检查权限／幂等／租约／重试／环境／退出／换号／注销级联；HTTP 用真实 Supabase SDK 模拟网络；发送器用真实本地 HTTP/2 和临时 P-256 签名校验。本地生产 HTTP 边界 10 项通过；发现并修正 Next 空 POST 流误报 400，定向回归及重建／lint／typecheck 后真实 HTTP 复查通过。阶段两轴审查及同绑定重复登记 P2 的修复复查通过，详见 [审查记录](mobile-stage-three-review-20261026.md)。

未使用真实 Apple 凭据／设备 token，未发送 APNs、迁移远端、购买服务、接通线上 cron、push／合并／部署。仍需托管 Auth session_id／not_after、PostgreSQL 多连接领取／改绑竞态、iPhone 授权／拒绝、TestFlight 环境、前后台／冷启动／离线／在途通知、跨账号和设备隔离，以及 Ticket 6 客户端缓存／通知清理联合验收。Ticket 1 延期项不变。
