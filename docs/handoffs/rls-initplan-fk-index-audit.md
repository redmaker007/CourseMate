# RLS InitPlan 与外键索引只读审计

## 结论

本次核对的 27 项全部为 **无冲突—可以修改**：

- 14 条生产 RLS 策略与最新 `main` 完整迁移链重建结果一致；
- 13 个生产外键的表、约束名、列顺序和删除行为与迁移链一致；
- 13 个外键均没有以外键列为前缀的有效非部分索引；
- 没有发现需要 Danny 与 redmaker 先行决定的冲突；
- 本阶段没有修改策略、创建索引、执行迁移或写入业务数据。

因此 Issue #41 可以按原任务范围进入方案确认，但本报告本身不启动正式实现。

## 核对范围与来源

- 核对时间：2026-09-27（生产查询时间 `2026-09-27 00:59:06.336675+00`）
- 生产项目：`xpmkpkplftgtfzecdwpd`
- 生产查询角色：`postgres`
- 代码基线：`b10ad8cb97e92f6556b52de381550d60dd1ff293`（当时最新 `origin/main`）
- 本地重建：按文件名顺序执行 24 个迁移，最后一个为 `202609250001_member_context_rpc.sql`
- 数据来源：生产 `pg_policies`、`pg_constraint`、`pg_index`、`pg_class`、`pg_namespace`、`pg_attribute`
- 核对方式：同一组目标名称分别查询生产系统目录和 PGlite 完整迁移链重建结果，再比较策略全部字段与外键结构字段

开始核对时，本地 `.env.local` 与 CLI 链接仍指向旧项目 `ltlladjfjuyzyorvntfl`。在执行任何生产 SQL 前已停止，并由 Danny 将本地 URL、匿名密钥和 CLI 链接切换到上述正式项目。旧项目上的两次尝试均在 SQL 执行前失败，没有产生数据库查询或写入。

## RLS 策略逐项结果

以下策略在生产和完整迁移链中均为 `PERMISSIVE`，角色均为 `authenticated`。表中的条件来自生产 `pg_policies`；自动对照同时验证了 schema、表、策略名、模式、角色、命令、`qual` 与 `with_check`。

| 表 / 策略 | 命令 | 生产条件 | 与 `main` 对照 | 结论 |
|---|---|---|---|---|
| `behavior_reports.behavior_reports_select_own` | SELECT | `qual: (has_completed_onboarding() AND (reporter_id = auth.uid()))` | 全字段相同 | 无冲突—可以修改 |
| `course_catalog.course_catalog_select_own_school` | SELECT | `qual: (has_completed_onboarding() AND (school_id = current_school_id()))` | 全字段相同 | 无冲突—可以修改 |
| `course_members.course_members_select` | SELECT | `qual: (has_completed_onboarding() AND ((user_id = auth.uid()) OR is_course_member(course_id)))` | 全字段相同 | 无冲突—可以修改 |
| `course_members.course_members_insert_self` | INSERT | `with_check: (has_completed_onboarding() AND (user_id = auth.uid()) AND (EXISTS (SELECT 1 FROM courses c JOIN school_term_settings terms ON terms.school_id = c.school_id WHERE c.id = course_members.course_id AND c.school_id = current_school_id() AND c.term = terms.current_term)))` | 全字段相同 | 无冲突—可以修改 |
| `course_members.course_members_delete_self` | DELETE | `qual: (has_completed_onboarding() AND (user_id = auth.uid()) AND (EXISTS (SELECT 1 FROM courses c JOIN school_term_settings terms ON terms.school_id = c.school_id WHERE c.id = course_members.course_id AND c.school_id = current_school_id() AND c.term = terms.current_term)))` | 全字段相同 | 无冲突—可以修改 |
| `courses.courses_select_own_school` | SELECT | `qual: (has_completed_onboarding() AND (school_id = current_school_id()))` | 全字段相同 | 无冲突—可以修改 |
| `friend_preferences.friend_preferences_select_owner` | SELECT | `qual: (has_completed_onboarding() AND (owner_id = auth.uid()))` | 全字段相同 | 无冲突—可以修改 |
| `friend_requests.friend_requests_select_participant` | SELECT | `qual: (has_completed_onboarding() AND ((auth.uid() = requester_id) OR (auth.uid() = recipient_id)))` | 全字段相同 | 无冲突—可以修改 |
| `friendships.friendships_select_participant` | SELECT | `qual: (has_completed_onboarding() AND ((auth.uid() = pair_low) OR (auth.uid() = pair_high)))` | 全字段相同 | 无冲突—可以修改 |
| `member_blocks.member_blocks_select_owner` | SELECT | `qual: (has_completed_onboarding() AND (blocker_id = auth.uid()))` | 全字段相同 | 无冲突—可以修改 |
| `profiles.profiles_insert_self` | INSERT | `with_check: (id = auth.uid())` | 全字段相同 | 无冲突—可以修改 |
| `profiles.profiles_select_self_or_classmate` | SELECT | `qual: ((id = auth.uid()) OR (has_completed_onboarding() AND shares_course_with(id)))` | 全字段相同 | 无冲突—可以修改 |
| `profiles.profiles_update_self` | UPDATE | `qual: (id = auth.uid()); with_check: (id = auth.uid())` | 全字段相同 | 无冲突—可以修改 |
| `school_term_settings.school_term_settings_select_own_school` | SELECT | `qual: (has_completed_onboarding() AND (school_id = current_school_id()))` | 全字段相同 | 无冲突—可以修改 |

逐行函数 `is_course_member(course_id)` 与 `shares_course_with(id)` 在生产和迁移链中均保持原样；后续迁移不能把它们改成一次性固定值。

## 外键与索引逐项结果

“覆盖索引”要求有效、非部分索引的开头列与外键列顺序一致。主键或其他索引即使位于同一张表，只要不是从外键列开始，就不算覆盖。

| 表 / 外键 | 外键列（按顺序） | 外键定义 | 生产覆盖索引 | 与 `main` 对照 | 结论 |
|---|---|---|---|---|---|
| `admin_audit_log.admin_audit_log_actor_id_fkey` | `actor_id` | `REFERENCES auth.users(id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |
| `admin_school_test_context.admin_school_test_context_school_id_fkey` | `school_id` | `REFERENCES schools(id) ON DELETE CASCADE` | 无 | 相同 | 无冲突—可以修改 |
| `courses.courses_created_by_fkey` | `created_by` | `REFERENCES member_accounts(user_id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |
| `direct_conversations.direct_conversations_member_high_fkey` | `member_high` | `REFERENCES member_accounts(user_id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |
| `direct_message_cleanup_eligibility.direct_message_cleanup_eligibility_message_fkey` | `conversation_id, message_id` | `REFERENCES messages(conversation_id, id) ON DELETE CASCADE` | 无 | 相同 | 无冲突—可以修改 |
| `friend_preferences.friend_preferences_owner_id_fkey` | `owner_id` | `REFERENCES member_accounts(user_id) ON DELETE CASCADE` | 无 | 相同 | 无冲突—可以修改 |
| `friend_rate_limit_buckets.friend_rate_limit_buckets_action_kind_fkey` | `action_kind` | `REFERENCES friend_rate_limit_config(action_kind)` | 无 | 相同 | 无冲突—可以修改 |
| `friend_requests.friend_requests_recipient_id_fkey` | `recipient_id` | `REFERENCES member_accounts(user_id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |
| `friend_requests.friend_requests_requester_id_fkey` | `requester_id` | `REFERENCES member_accounts(user_id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |
| `friendships.friendships_pair_high_fkey` | `pair_high` | `REFERENCES member_accounts(user_id) ON DELETE CASCADE` | 无 | 相同 | 无冲突—可以修改 |
| `member_accounts.member_accounts_school_id_fkey` | `school_id` | `REFERENCES schools(id)` | 无 | 相同 | 无冲突—可以修改 |
| `member_blocks.member_blocks_blocked_id_fkey` | `blocked_id` | `REFERENCES member_accounts(user_id) ON DELETE CASCADE` | 无 | 相同 | 无冲突—可以修改 |
| `platform_roles.platform_roles_granted_by_fkey` | `granted_by` | `REFERENCES auth.users(id) ON DELETE SET NULL` | 无 | 相同 | 无冲突—可以修改 |

组合外键 `direct_message_cleanup_eligibility_message_fkey` 的顺序已确认是 `(conversation_id, message_id)`。生产已有的清理批次索引不是从这组列开始，不能替代该外键索引。

## 冲突与待决策项

没有发现目标策略、目标外键或现有覆盖索引方面的冲突。

Issue #41 开始前仍需按项目协作约定由 Danny 最终确认是否接受原任务方案；这不是数据库结构冲突。

## 可重复执行的只读查询

下面的 SQL 只读取 PostgreSQL 系统目录，不修改 schema、策略、索引或业务数据。

```sql
with
target_policies(policyname) as (
  values
    ('behavior_reports_select_own'),
    ('course_catalog_select_own_school'),
    ('course_members_select'),
    ('course_members_insert_self'),
    ('course_members_delete_self'),
    ('courses_select_own_school'),
    ('friend_preferences_select_owner'),
    ('friend_requests_select_participant'),
    ('friendships_select_participant'),
    ('member_blocks_select_owner'),
    ('profiles_insert_self'),
    ('profiles_select_self_or_classmate'),
    ('profiles_update_self'),
    ('school_term_settings_select_own_school')
),
target_constraints(conname) as (
  values
    ('admin_audit_log_actor_id_fkey'),
    ('admin_school_test_context_school_id_fkey'),
    ('courses_created_by_fkey'),
    ('direct_conversations_member_high_fkey'),
    ('direct_message_cleanup_eligibility_message_fkey'),
    ('friend_preferences_owner_id_fkey'),
    ('friend_rate_limit_buckets_action_kind_fkey'),
    ('friend_requests_recipient_id_fkey'),
    ('friend_requests_requester_id_fkey'),
    ('friendships_pair_high_fkey'),
    ('member_accounts_school_id_fkey'),
    ('member_blocks_blocked_id_fkey'),
    ('platform_roles_granted_by_fkey')
)
select
  'policy' as section,
  policies.policyname as item,
  jsonb_build_object(
    'schema', policies.schemaname,
    'table', policies.tablename,
    'permissive', policies.permissive,
    'roles', policies.roles,
    'command', policies.cmd,
    'qual', policies.qual,
    'with_check', policies.with_check
  ) as details
from pg_policies policies
join target_policies targets using (policyname)

union all

select
  'foreign_key' as section,
  constraints.conname as item,
  jsonb_build_object(
    'schema', namespaces.nspname,
    'table', tables.relname,
    'columns', (
      select jsonb_agg(attributes.attname order by keys.ordinality)
      from unnest(constraints.conkey)
        with ordinality as keys(attnum, ordinality)
      join pg_attribute attributes
        on attributes.attrelid = constraints.conrelid
       and attributes.attnum = keys.attnum
    ),
    'definition', pg_get_constraintdef(constraints.oid, true),
    'existing_indexes', coalesce((
      select jsonb_agg(
        pg_get_indexdef(indexes.indexrelid)
        order by index_relations.relname
      )
      from pg_index indexes
      join pg_class index_relations
        on index_relations.oid = indexes.indexrelid
      where indexes.indrelid = constraints.conrelid
        and indexes.indisvalid
    ), '[]'::jsonb)
  ) as details
from pg_constraint constraints
join target_constraints targets using (conname)
join pg_class tables on tables.oid = constraints.conrelid
join pg_namespace namespaces on namespaces.oid = tables.relnamespace

order by section, item;
```

核对覆盖关系时，逐个检查 `existing_indexes` 的起始列；部分索引不能作为整个外键的覆盖索引。
