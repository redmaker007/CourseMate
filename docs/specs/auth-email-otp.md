# 学校邮箱 OTP 登录

> 状态：讨论中。本文只记录已经确认的实现要求；剩余环境与实现决策将在后续讨论中补充。

## 目标

用户选择学校并验证该校允许的完整邮箱后，进入与该邮箱对应的 CourseMate 成员账号。当前交付网站流程，未来 App 复用相同认证后端和数据库不变量。

## 模块范围

本模块负责：读取登录所需的开放学校数据、校验所选学校与邮箱、请求发送 OTP、验证 OTP、自动绑定学校、建立和刷新登录会话，以及退出当前设备。

本模块不负责：Profile 收集或完整度、课程与群聊权限、认证成功后的页面设计、学校运营管理、学校停用后的既有成员策略、换邮箱、转校、未验证 Auth 记录清理、退出所有设备，以及额外风控。

## 认证流程

1. 已有有效会话时保持登录，不发送新 OTP；切换账号必须先退出当前设备。
2. 没有有效会话时，用户选择学校并输入完整邮箱。
3. 后端读取数据库规则校验学校和邮箱；无效时不请求发送。
4. Supabase 接受发送请求后进入六位 OTP 填写阶段。
5. 验证码阶段固定使用本次发送时的学校和完整邮箱；要修改任一内容必须返回上一步并重新发送。
6. 新邮箱在请求 OTP 时可先产生未验证 Auth 记录；旧邮箱继续对应原 Auth 用户。界面不区分或泄露新老用户状态。
7. Supabase 验证 OTP。数据库在邮箱首次变为已验证状态时自动且幂等地建立成员账号与学校绑定。
8. 只有 OTP 验证成功且 `member_accounts` 绑定存在时，模块才返回认证成功并建立 Cookie 会话。
9. 当前模块不执行页面跳转；未来网站接入时默认进入首页。

## 学校资格规则

- 用户必须先选择学校，且必须输入完整邮箱；系统不自动补全邮箱域名。
- 数据库是学校、域名和开放状态的唯一权威来源；前端和认证代码不得维护另一份白名单。
- `school_email_domains` 每行保存全局唯一的完整域名及所属 `school_id`。一所学校可以有多个明确域名，但一个域名只能属于一所学校。
- 域名只做精确匹配，不自动接受子域名。每个合法学生邮箱域名必须单独配置。
- 当前测试学校为 University of Wisconsin–Madison，只接受 `wisc.edu`，不接受 `cs.wisc.edu`。
- 发送前由网站后端校验；新 Auth 记录创建前由 Supabase `Before User Created Hook` 从同一数据库来源再次校验。
- 第一方网站代码只能通过认证 Server Actions 调用 Auth。Supabase 公开端点仍可能被外部直接请求，因此数据库 Hook 和触发器才是不可绕过的不变量防线。
- 邮箱无效或不属于所选学校时统一返回“请输入有效邮箱”，且不得请求发送 OTP。

## 输入规范化

- 邮箱去除整段首尾空格，只将 `@` 后的域名转换为小写。
- `@` 前的本地部分保留大小写、点号和 `+` 内容；应用不推断或合并学校邮箱别名。
- 验证码去除整体首尾空格后必须恰好为六个 ASCII 数字 `0-9`；格式无效时不调用 Supabase。

## OTP 规则

- CourseMate 官方界面和支持流程只提供六位 Email OTP，不提供密码或 Magic Link。
- 当前不承诺 Supabase 底层所有密码接口均被系统级禁用，也不为此引入复杂 Auth Hook；学校资格和业务授权只能依赖可信数据库绑定与 RLS，不能依赖认证方式。
- OTP 自发送起有效 10 分钟，过期后必须重新请求。
- 同一邮箱两次请求至少间隔 60 秒。Supabase Auth 配置负责真正限流，页面同步显示倒计时；CourseMate 当前不另建限流状态。
- 当前不增加每日发送上限、按验证码统计的输错锁定、CAPTCHA、额外邮箱/IP 限流或异常监控。
- OTP 的生成、验证状态、过期和一次性使用由 Supabase Auth 负责。CourseMate 不建立验证码表、不持久化 OTP 明文，也不写入日志、分析事件或浏览器持久化存储。
- 重发后不关心旧 OTP 是否仍有效。最新一次成功请求产生且未使用的 OTP 是否能在 10 分钟内完成验证，必须由受控 Supabase 环境的集成测试确认。

## 成员账号与学校绑定

- 首次 OTP 验证成功后，后台自动将 Auth 用户绑定到由邮箱精确域名确定的唯一 `school_id`；用户无需额外操作。
- 绑定存入独立 `member_accounts` 表，以 Auth `user_id` 为唯一主键；邮箱继续只由 Supabase Auth 保存。
- 绑定不依赖可选 Profile；昵称等资料不阻塞认证成功。
- 写入必须幂等。重复触发且绑定一致时不创建第二条记录；找不到唯一学校或绑定冲突时，认证不得成功。
- 当前完全禁止修改登录邮箱或学校绑定。数据库在 `auth.users.email` 更新前拒绝邮箱变化，RLS 禁止成员新增、修改或删除 `member_accounts`。

## 会话

- CourseMate 有效会话必须同时满足：Supabase `getUser()` 返回有效用户，且该用户存在一致的 `member_accounts` 学校绑定。仅有 JWT/Auth 用户不算 CourseMate 已登录。
- 认证模块与 `src/proxy.ts` 必须复用同一成员会话判断；没有可信绑定的 Auth 会话不得返回 `already_signed_in` 或访问受保护页面。
- 会话默认持久保存；关闭浏览器后再次访问仍保持登录，除非主动退出、会话失效或被后台撤销。
- 网站使用安全 Cookie，并由服务端刷新 Supabase 会话。
- 同一账号允许多个设备同时保持独立会话，新设备登录不撤销其他设备。
- 主动退出只撤销当前设备会话。

## 后端 Interface

第一方网站通过 Next.js Server Actions 调用认证模块：

- `requestEmailCode(schoolId, email)`：检查现有会话，读取学校规则，校验邮箱并请求 Supabase 发送 OTP。
- `verifyEmailCode(schoolId, email, code)`：再次校验输入，验证 OTP，确认自动学校绑定存在并建立 Cookie 会话。
- `signOutCurrentSession()`：只撤销当前设备会话并清除对应 Cookie。

Interface 返回稳定的 discriminated union 业务结果，不向调用方泄漏 Supabase 或 SMTP 原始响应。

认证模块内部定义 Supabase Auth port。生产 Adapter 调用真实 Supabase，测试 Fake Adapter 返回可控的发送、验证、限流和失败结果。Fake 只用于验证认证模块契约，不能作为真实 Supabase、数据库触发器或邮件投递已经通过验收的证据。

`requestEmailCode` 返回：

- `code_sent`：Supabase 已接受发送请求。
- `already_signed_in`：当前设备已有有效会话，未发送 OTP。
- `invalid_email`：邮箱格式、所选学校或精确域名规则不符合。
- `rate_limited`：Supabase 拒绝过于频繁的请求。
- `send_failed`：OTP 发送请求明确失败。
- `temporarily_unavailable`：数据库、网络或配置暂时异常。

`verifyEmailCode` 返回：

- `signed_in`：OTP 正确、学校绑定存在且会话已建立。
- `already_signed_in`：当前设备已有有效会话，不再验证输入。
- `invalid_email`：学校或邮箱参数不符合规则。
- `invalid_or_expired_code`：验证码格式错误、内容错误、已使用或过期。
- `rate_limited`：Supabase 拒绝过于频繁的验证请求。
- `temporarily_unavailable`：数据库绑定、网络或配置暂时异常；内部日志保留安全的原因分类。

`signOutCurrentSession` 返回：

- `signed_out`：当前会话已清除；原本没有会话时也返回此结果。
- `temporarily_unavailable`：会话系统或基础设施异常。

## 错误与日志

- 邮箱无效：提示“请输入有效邮箱”。
- OTP 错误或过期：提示“验证码错误或已过期，请重新检查或获取新验证码”。
- Supabase 发送或验证限流：提示“操作过于频繁，请稍后再试”。
- Supabase 或邮件渠道明确返回发送失败：不进入验证码阶段，保留学校和邮箱，提示“验证码发送失败，请稍后重试”。
- Supabase 接受发送请求：只提示“验证码已发送，请检查收件箱和垃圾邮件”，不声称邮件已经送达；60 秒后可重发，也可修改输入。
- 不向用户显示供应商、数据库或 Supabase 原始错误。
- 日志不得记录完整邮箱或 OTP；只记录请求编号、学校 ID、操作类型、稳定结果分类、必要状态码，以及确有需要时的掩码邮箱。
- 生产日志不得原样记录可能包含个人信息或敏感字段的供应商响应。

## 数据模型与数据库约束

- `schools`：保存学校身份、公开名称及当前开放配置。
- `school_email_domains(domain, school_id)`：`domain` 全局唯一并精确匹配学校。
- `member_accounts(user_id, school_id, created_at)`：`user_id` 是引用 Auth 用户的主键；`school_id` 不为空；不重复保存邮箱。
- `member_accounts` 启用 RLS：成员只能读取自己的绑定，不能直接写入。
- Auth 邮箱首次确认触发器负责原子创建 `member_accounts`；邮箱更新前触发器负责禁止邮箱变化。触发器失败必须让对应 Auth 数据库事务失败，而不是留下成功会话和缺失绑定。
- `origin/feature/db-schema` 当前使用 `schools.domains text[]`、接受子域名且只在 `profiles` 保存学校归属，与本 Spec 冲突；完成改造和数据库验证前不得按现状合并。

## 邮件投递

- 应用代码只依赖 Supabase Auth；邮件投递通过 Supabase Custom SMTP 配置，供应商可替换。
- 开发期计划使用免费 SMTP；真实配置、Sender 和凭据等到代码完成后的联调阶段处理，秘密不得提交 Git。
- 邮件使用简短中英双语模板，不包含 Magic Link。
- 主题为“CourseMate 登录验证码 / Sign-in code”；正文包含六位 OTP、10 分钟有效期和非本人操作提示。

## 完成标准

交付分为两个阶段：

1. 本地实现阶段：完成应用代码、SQL migration 和不依赖真实邮件的自动化测试。此时只能声明代码实现完成。
2. 集成验收阶段：创建专用 Supabase 测试项目，实际运行 migration，验证 Auth Hook、数据库触发器、Cookie 会话和 OTP，再接入 Custom SMTP 与真实 `@wisc.edu` 邮箱。此阶段完成后才能声明认证系统验收通过。

第一阶段的 Fake Adapter 单元/契约测试至少覆盖：

- 精确 `@wisc.edu` 可请求 OTP；Gmail、子域名、错误格式在发送前被拒绝。
- 新旧邮箱在无有效会话时都需要 OTP；已有会话时不发送新 OTP。
- 只有 Supabase Auth 会话、没有 `member_accounts` 绑定时，不得被识别为 `already_signed_in` 或放行受保护页面。
- Supabase Adapter 返回错误、过期、限流或成功时，认证模块映射到正确稳定结果。
- 模拟绑定成功、缺失和冲突时，只有完整绑定返回 `signed_in`。
- 当前设备退出的 interface 行为幂等。
- 稳定错误结果不泄露账号是否存在、供应商细节、完整邮箱或 OTP。

第二阶段的真实 Supabase 集成与人工联调至少覆盖：

- 配置托管 Supabase 与开发期 Custom SMTP。
- 真实 `@wisc.edu` 邮箱收到最新六位 OTP 并成功登录。
- 关闭并重新打开浏览器后仍保持登录。
- 实际 Auth 事务触发器原子、幂等地创建学校绑定，并拒绝登录邮箱更新。
- 错误、过期和已使用 OTP、60 秒冷却、当前设备退出及多设备会话符合配置。

项目允许增加仅用于开发的自动化测试工具和统一 `npm test` 命令。自动化测试不得依赖真实邮件；具体工具版本在实现时按 Next.js 16 与 TypeScript 配置兼容性选择并锁定。


## 开发与合并策略

- 从当前 `main` 新建 `feature/email-otp-auth`。
- 本功能所需的数据库 migration、Auth Hook、触发器、Server Actions、测试和正式文档在同一功能分支交付并 review。
- `origin/feature/db-schema` 与本 Spec 冲突，暂不按现状合并；后续数据库工作必须基于新的认证数据模型调整。
