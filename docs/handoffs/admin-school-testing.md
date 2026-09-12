# 管理员跨校测试交接

> 历史交接：正文进度、待办、分支与验证结果只代表记录时点；当前进度统一维护在 [STATUS.md](../STATUS.md)。操作步骤见 [操作手册索引](../../README.md#操作手册)，只需定位模块时见 [任务与代码索引](../README.md)。

记录日期：2026-09-12。分支 `codex/admin-school-testing`。设计与取舍见 [ADR-0006](../adr/0006-admin-cross-school-testing.md)，操作见[管理手册](../runbooks/platform-admin.md)「切换测试学校」。

## 分工

- **Codex 完成**：migration 主体、`/admin` 的切换入口、各页面顶部的测试横幅、`getCurrentMember` 返回当前学校与 `homeSchoolId`、私聊只读提示文案。Codex 在额度用尽时停下，没有写测试，类型检查也未通过。
- **本轮补齐**：新函数的类型、全部测试、`list_friends` 的学校过滤、ADR 与文档，并逐一核对了被重写的函数。

## 数据流

1. `admin_school_test_context(user_id, school_id)`：`user_id` 外键指向 `platform_roles`（撤销身份时级联删除），`school_id` 指向 `schools`。对客户端不授权、不建策略。
2. `effective_member_school_id(user)`（内部函数，不对客户端开放）：测试上下文仍有效——对方仍是 admin/owner、测试学校仍开放——就返回测试学校，否则返回账号归属。
3. `current_school_id()` 改为返回当前学校。依赖它的 RLS（`courses`、`course_catalog`、`school_term_settings`、`course_members` 的加入与退出）因此自动按当前学校生效。
4. `is_course_member`、`shares_course_with`、`can_access_course_conversation` 增加「课程所属学校 = 当前学校」。`can_send_to_course_conversation` 本身不必改，它先调用 `can_access_course_conversation`。课程消息的读写、会话成员列表、同课同学资料由此一并收回。
5. `can_send_to_direct_conversation` 增加「双方当前学校相同」。`send_conversation_message` 的私聊分支，以及 `get_direct_conversation_view` 的 `send_status`，都经它判断。所以切校后，页面显示只读，直接调用也被拒。
6. 好友：`send_friend_request`、`respond_to_friend_request`、`find_member_by_email` 按当前学校判断。`set_member_blocked` 对已有往来的外校成员放行，保证自我保护。`create_behavior_report` 的资料举报按当前学校判断。
7. `admin_set_test_school`：校验 admin → 校验 onboarding → 锁住自己的 `platform_roles` 行后再校验一次（与撤销串行）→ 选回本校即删除上下文 → 写操作记录 `school.test_switch`。
8. 应用层：`getCurrentMember` 并行调用 `has_completed_onboarding` 与 `current_school_id`；`schoolId` 是当前学校，与归属不同时另带 `homeSchoolId`。`proxy` 门禁与资料保存仍用归属会话，登录不受影响。

## 核查过的风险

- **被重写的 11 个函数有没有丢掉组员后来的修改。** 用 PGlite 分别导出 `202609120002` 执行前后的函数定义逐一对比：除学校判断外没有其他差异，执行权授予也一致。diff 看起来整段不同，是换行符造成的。
- **一处影响普通用户的行为变化**：`respond_to_friend_request` 把「拒绝」提前到拉黑与学校检查之前。以前对拉黑方发来的申请点拒绝，返回 `blocked`；现在返回 `rejected`，申请被正常关闭。跨校之后也能拒绝待处理的申请。这是 Codex 的改动，判断为改进，予以保留，测试已覆盖。
- **`list_friends` 原先的重写是空改动**：注释写着同步学校边界，实际没有改。本轮补上共同课程按当前学校过滤，对普通成员没有影响。

## 验证（2026-09-12 本次实际运行）

- 全量：73 个测试文件、444 项测试，构建、lint、类型检查依次通过。
- `supabase/migrations/admin-school-testing.test.ts`，15 项。自动加载全部 20 条迁移，覆盖：
  - 入口权限：未登录、普通成员伪造请求、未开放学校、内部函数与上下文表关闭。
  - 操作记录。
  - 课程群：进入测试学校后可加入并发言；切回本校后读不到、发不了，绕过 RPC 直接写表也被拒；选课记录与历史保留，再次进入即恢复。
  - 撤销身份、关闭学校都会清除测试状态，重新任命、重新开放也不会恢复。
  - 好友与私聊：同校可加好友、私聊；切回本校后双方都不能再发，历史可读，显示只读，对方搜不到。
  - 切校后仍能拉黑有往来的成员、拒绝待处理的申请，但不能接受；毫无往来的外校成员不能拉黑。
  - 普通成员的当前学校就是归属，跨校加好友仍被拒。
- `src/features/auth/session.test.ts`（3 项）：当前学校与 `homeSchoolId`；读不到当前学校时按未登录处理。
- `school-test-banner.test.tsx`（2 项），以及管理页测试里「进入测试学校」入口的断言。

## 没验证、要注意的

- **没有在任何真实数据库执行过这条迁移。** 生产还缺它依赖的前 8 条（见 STATUS），它只能排在最后。
- 真实 Realtime 订阅在切校那一刻的表现没有实测。RLS 会对每个事件重新判断，预期切校后停止推送。
- 本地、预览与生产共用一个数据库，**测试写入的是真实数据**，见 ADR-0006「代价」。
- 每个页面多一次 RPC。页面慢的问题（STATUS 已记录）没有因此重新测量。
