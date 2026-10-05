-- 课程群聊页的数据合并为一次调用。
--
-- 此前 getCourseRoom 先做访问校验（成员身份、课程、会话关联并行，再查会话归档状态，两轮），
-- 再取名单与消息（各自还要再查一次资料表拿昵称，又是两轮），共四轮串行请求，每轮都要跨一次
-- 网络（约 80ms）。这个函数在数据库内部一次做完，返回课程、会话、成员名单和最近消息。
--
--   · security invoker：所有表照常按调用者的 RLS 读取，可见范围与原来逐表查询完全一致
--     （名单只含调用者能看到的 conversation_members，昵称只含调用者能看到的 profiles）。
--     不引入新的数据来源，也不放宽任何可见性。
--   · 身份只取 auth.uid()，学校由调用方传入并与 courses.school_id 比对，与原来一致。
--   · 语义与原代码逐项对应：不是成员、课程不在该学校、没有会话关联、会话行读不到，任一不满足
--     都返回 null（页面显示 404）；归档状态取 conversations.archived_at。
--   · 昵称读不到时返回 null，由调用方沿用原来的兜底（成员 →「成员」，已注销发送者 →
--     「已注销用户」），数据库不替它决定文案。
--   · 好友关系摘要仍由 list_course_member_relationships 单独提供（它是 security definer，
--     自己校验成员身份），调用方与本函数并行发出。
--   · 消息条数由调用方指定，函数内限制在 1 到 200，避免被当作无限制读取接口。
--
-- 只新增函数，旧前端不调用它，所以必须先于新前端应用（先应用迁移，再发布前端）。
begin;

create function public.get_course_room(
  target_course uuid,
  target_school text,
  message_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with access as (
    select
      course.id,
      course.school_id,
      course.code,
      course.title,
      course.term,
      link.conversation_id,
      conversation.archived_at
    from public.course_members membership
    join public.courses course
      on course.id = membership.course_id
     and course.school_id = target_school
    join public.course_conversations link
      on link.course_id = course.id
    join public.conversations conversation
      on conversation.id = link.conversation_id
    where membership.course_id = target_course
      and membership.user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'course', jsonb_build_object(
      'id', access.id,
      'school_id', access.school_id,
      'code', access.code,
      'title', access.title,
      'term', access.term
    ),
    'conversation_id', access.conversation_id,
    'archived', access.archived_at is not null,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', member.user_id,
          'display_name', profile.display_name,
          'avatar_url', profile.avatar_url
        )
        order by member.joined_at, member.user_id
      )
      from public.conversation_members member
      left join public.profiles profile on profile.id = member.user_id
      where member.conversation_id = access.conversation_id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'sender_id', recent.sender_id,
          'sender_name', recent.sender_name,
          'body', recent.body,
          'created_at', recent.created_at,
          'client_message_id', recent.client_message_id
        )
        order by recent.id
      )
      from (
        select
          message.id,
          message.sender_id,
          sender.display_name as sender_name,
          message.body,
          message.created_at,
          message.client_message_id
        from public.messages message
        left join public.profiles sender on sender.id = message.sender_id
        where message.conversation_id = access.conversation_id
        order by message.id desc
        limit least(greatest(coalesce(message_limit, 50), 1), 200)
      ) recent
    ), '[]'::jsonb)
  )
  from access;
$$;

-- 与其他函数一样显式收回三个角色，再只授予已登录用户（见 202609100005 的教训）。
revoke all on function public.get_course_room(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_course_room(uuid, text, integer) to authenticated;

commit;
