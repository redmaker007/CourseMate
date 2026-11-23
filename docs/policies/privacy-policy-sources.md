# 隐私政策事实来源与 App 隐私标签草稿

日期：2026-11-22。隐私政策页 `src/app/privacy/page.tsx` 的每条事实都应该能在这里找到代码或迁移出处。功能有变化时，先改这里，再改页面。待确认的事实见[待决定事项](privacy-and-safety-open-questions.md)第三部分。

## 收集的数据 → 出处

| 政策中的说法 | 出处 |
|---|---|
| 学校邮箱，用于验证码和判定学校 | Supabase `auth.users.email`；`202609050001_email_otp_request.sql`（准入 Hook、`school_email_domains`）；成员列表不展示邮箱（`src/app/(member)/courses/[courseId]/page.tsx`） |
| 账号编号、学校、注册时间 | `member_accounts(user_id, school_id, created_at)` |
| 最近一次验证码确认时间、密码只存哈希 | `member_auth_state(email_verified_at, password_fingerprint, password_set_at)`，`202610270001_password_sign_in.sql`；密码哈希由 Supabase Auth 保存在 `auth.users.encrypted_password`；fingerprint 是哈希的 md5，不是密码 |
| 显示名（必填）、专业、毕业年份（选填） | `profiles`，`202609070001_course_and_chat_schema.sql`。`avatar_url` 有字段但没有上传或编辑入口，政策里没写 |
| 课程 | `course_members` |
| 好友申请附言、好友关系、备注、隐藏、拉黑 | `friend_requests.message`（≤300 字）、`friendships`、`friend_preferences(note ≤15 字, hidden)`、`member_blocks`，`202609100003_friendship_backend.sql` |
| 消息、已读位置、清空记录 | `messages`、`conversation_members(last_read_message_id, cleared_through_message_id)`、`direct_message_clear_ranges` |
| 举报与证据快照 | `behavior_reports`、`report_evidence.snapshot`、`report_source_retention`，`202609110004_reporting.sql`；课程消息见 `202611220001_course_message_reporting.sql`（PR #67） |
| iOS 推送令牌、安装编号、会话编号 | `mobile_push_devices(installation_id, session_id, device_token, environment)`，`202610260002_mobile_push.sql` |
| 网页推送订阅 | `push_subscriptions(endpoint, p256dh, auth_secret)`，`202610040001_web_push.sql`（生产环境变量未配置，功能关闭） |
| 限流计数 | `friend_rate_limit_buckets` |
| 管理员审计 | `admin_audit_log`；授予管理员时 `details` 含邮箱（`202609100006_platform_admin.sql`） |
| Cookie | Supabase 会话 Cookie（`src/lib/supabase/server.ts`、`proxy.ts`）、主题 `coursemate-theme`（`src/features/theme/theme-preference.ts`） |
| 不用广告和统计 SDK | `package.json` 的 dependencies 只有 Supabase、Next/React、lucide-react、web-push、server-only（2026-11-22）。原生 App 由丹尼确认 |

## 第三方 → 出处

| 服务 | 出处 |
|---|---|
| Supabase（美国） | 生产库 CourseMate-east，区域 us-east-2（俄亥俄） |
| Vercel | `docs/runbooks/deploy.md` |
| Brevo 发验证码 | `docs/runbooks/new-supabase-project.md` 第 3 节（自定义 SMTP） |
| APNs，通知只含发送者名 | `src/features/push/apns.ts`：`alert: { title: sender_name, body: "发来一条消息" }` |

## 保留与注销 → 出处

| 说法 | 出处 |
|---|---|
| 注销删除账号、资料、关系、推送登记；本人消息换成“[消息已删除]”；删除相关好友申请 | `permanently_delete_member`，`202610260001_permanent_account_deletion.sql` |
| 举报匿名保留（去掉 ID 和资料快照，保留原因、说明和正文） | 同上；决定记录见 `docs/handoffs/account-deletion-design.md` |
| 注销要邮箱验证码，只在 App 内 | `docs/handoffs/mobile-account-deletion-api.md`；网页没有注销入口 |
| 退出课程后消息保留 | 退出只删除 `course_members` 和 `conversation_members`，不删 `messages` |
| 私聊不会自动清理 | 720 小时清理能力存在但没有定时任务（`docs/handoffs/direct-message-cleanup.md`） |

---

## App Store「App 隐私」标签填写草稿

依据 Apple「App Privacy Details」页（2026-11-22 核对）的分类。原则：宁可多报，不要漏报。下面的“关联到用户”都填**是**（数据都挂在账号上）；“用于追踪”全部填**否**（没有广告，也不与第三方共享用于广告）。

| Apple 分类 → 数据类型 | 是否收集 | 用途（Apple 选项） | 说明 |
|---|---|---|---|
| Contact Info → Email Address | 是 | App Functionality | 学校邮箱，用于登录和学校验证 |
| Contact Info → Name | 是（建议申报） | App Functionality | 显示名，很多人会填真名 |
| User Content → Emails or Text Messages | 是 | App Functionality | 课程群和私聊消息 |
| User Content → Other User Content | 是 | App Functionality | 好友申请附言、举报说明、好友备注 |
| User Content → Customer Support | 待定 | App Functionality | 联系邮箱开通后，用户来信算客服数据 |
| Identifiers → User ID | 是 | App Functionality | 账号 UUID |
| Identifiers → Device ID | 建议申报（待你决定） | App Functionality | APNs 设备令牌和安装编号会保存并关联账号。Apple 没点名推送令牌，申报更稳妥 |
| Other Data → Other Data Types | 是 | App Functionality | 学校、专业、毕业年份、课程、好友和拉黑关系 |
| Usage Data／Diagnostics | 否（待丹尼确认） | — | 后端没有统计或崩溃 SDK；App 端如接入就要改成“是” |
| Location、Contacts、Photos、Health、Financial、Browsing／Search History、Purchases、Sensitive Info | 否 | — | 没有收集 |

额外说明：

- 举报和防滥用记录：Apple 的用途选项里没有单独的“安全”，一般并入 App Functionality；如果想说明得更细，可以加选 Other Purposes。
- 服务器访问日志里的 IP：不用于定位，也不由我们另外保存，按 Apple 说明可以不申报；如果以后用 IP 做限流或风控并保存，要申报。
- 隐私政策 URL 填 `https://<生产域名>/privacy`。生产域名在页面上线后再填。
