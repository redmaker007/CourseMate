-- 教学示例：课程成员关系摘要的最小 SQL。
--
-- 这是只读练习，不创建表、不创建函数、不修改任何数据。
-- 可以粘贴到 PostgreSQL / Supabase SQL Editor 观察结果，但不要把它当成 migration。

with
-- params 模拟 RPC 参数和 auth.uid()。
params(current_user_id, course_id) as (
  values (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  )
),

-- 模拟同一门课程里的五个人：Alice 是当前用户。
course_members(course_id, user_id, display_name) as (
  values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
     '11111111-1111-4111-8111-111111111111'::uuid, 'Alice'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
     '22222222-2222-4222-8222-222222222222'::uuid, 'Bob'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
     '33333333-3333-4333-8333-333333333333'::uuid, 'Carol'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
     '44444444-4444-4444-8444-444444444444'::uuid, 'Dave'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
     '55555555-5555-4555-8555-555555555555'::uuid, 'Eve')
),

-- Alice 和 Bob 是好友，并且已经有私聊。
friendships(member_a, member_b, active, conversation_id) as (
  values (
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    true,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
  )
),

-- Alice 向 Carol 发过申请；Dave 向 Alice 发过申请。
friend_requests(requester_id, recipient_id, status) as (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid,
     '33333333-3333-4333-8333-333333333333'::uuid, 'pending'),
    ('44444444-4444-4444-8444-444444444444'::uuid,
     '11111111-1111-4111-8111-111111111111'::uuid, 'pending')
),

-- Alice 拉黑了好友 Bob；Eve 拉黑了 Alice。
-- Bob 仍然必须被识别为好友，只是不能发送消息。
member_blocks(blocker_id, blocked_id) as (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid,
     '22222222-2222-4222-8222-222222222222'::uuid),
    ('55555555-5555-4555-8555-555555555555'::uuid,
     '11111111-1111-4111-8111-111111111111'::uuid)
),

-- 先把每位课程成员和当前用户的事实整理成一行。
facts as (
  select
    member.user_id as member_id,
    member.display_name,
    friendship.active as active_friendship,
    friendship.conversation_id,
    exists (
      select 1
      from friend_requests request
      where request.requester_id = actor.current_user_id
        and request.recipient_id = member.user_id
        and request.status = 'pending'
    ) as outgoing_request,
    exists (
      select 1
      from friend_requests request
      where request.requester_id = member.user_id
        and request.recipient_id = actor.current_user_id
        and request.status = 'pending'
    ) as incoming_request,
    exists (
      select 1
      from member_blocks block
      where (block.blocker_id = actor.current_user_id
             and block.blocked_id = member.user_id)
         or (block.blocker_id = member.user_id
             and block.blocked_id = actor.current_user_id)
    ) as restricted
  from params actor
  join course_members member on member.course_id = actor.course_id
  left join friendships friendship
    on friendship.active
   and actor.current_user_id in (friendship.member_a, friendship.member_b)
   and member.user_id in (friendship.member_a, friendship.member_b)
  where member.user_id <> actor.current_user_id
)

-- 最后把数据库事实翻译成页面需要的三个独立状态。
select
  member_id,
  display_name,
  case
    -- 好友优先：即使被拉黑，也不能重新显示“添加好友”。
    when active_friendship then 'friend'
    when outgoing_request then 'outgoing_request'
    when incoming_request then 'incoming_request'
    else 'none'
  end as relationship_status,
  case when restricted then 'blocked' else 'none' end as restriction_status,
  case
    -- SQL 的 NULL 不是 false；IS NOT TRUE 同时覆盖 false 和 NULL。
    when active_friendship is not true then null
    when restricted then 'blocked'
    else 'allowed'
  end as send_status,
  case when active_friendship then conversation_id else null end as conversation_id
from facts
order by display_name;

-- 预期结果：
-- Bob   -> friend / blocked / blocked / 有 conversation_id
-- Carol -> outgoing_request / none / null / null
-- Dave  -> incoming_request / none / null / null
-- Eve   -> none / blocked / null / null
--
-- 正式 Supabase RPC 会把核心查询放入 SECURITY DEFINER 函数，并额外做到：
-- 1. 用 auth.uid() 代替 params.current_user_id；
-- 2. 验证调用者已经完成 onboarding；
-- 3. 验证调用者属于 target_course_id，且课程属于 current_school_id()；
-- 4. 固定 search_path = ''；
-- 5. 撤销 public / anon 权限，只授予 authenticated；
-- 6. 使用真实表的无序成员对 pair_low / pair_high 和 active request 表避免重复。
