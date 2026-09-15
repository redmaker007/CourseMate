-- 课程会话改为"第一个学生加入时才建"，不再随建课/物化目录立即建。
--
-- 现状：courses 表上的 after insert 触发器 courses_auto_create_conversation
-- （create_conversation_for_course()）在建课/物化目录那一刻就无条件建好
-- conversations + course_conversations，不管这门课有没有学生。这个代价在
-- 目录整合上线时就已经记录（docs/handoffs/course-catalog-integration.md
-- 「一个已知代价」）：一所学校几千门课，就是几千个空会话。见 ADR-0007。
--
-- 本迁移做三件事：
--   1. 一次性清理：把已有的、目前 0 个 conversation_members 的课程会话删掉，
--      让老数据也符合新的不变式——「有 course_conversations 记录 ⟺ 至少一名
--      学生已经加入这门课」。
--   2. 去掉 courses_auto_create_conversation 触发器与
--      create_conversation_for_course() 函数：建课/物化目录不再建会话。
--   3. 重写 sync_course_conversation_membership() 的 INSERT 分支：
--      course_members 的第一行插入时，找不到已有的 course_conversations 就
--      现建一条（conversations + course_conversations），再插入
--      conversation_members；第二个及以后加入的学生走原来"直接加入已有会话"
--      的路径，不受影响。DELETE 分支基本不变，只加一个 null 防御。
--
-- 为什么不需要复刻旧 create_conversation_for_course() 里按学期比较来决定
-- archived_at 的逻辑：course_members_insert_self
-- （202609100002_course_flow.sql 第 47-61 行）已经把"能加入"限定为
-- 「course.term = school_term_settings.current_term」。也就是说，惰性路径
-- 能创建会话，只可能发生在这门课就是当前学期课的时候——不会出现旧模型里
-- "预置未来学期课程"那种需要立刻标记归档的场景。所以惰性创建的会话一律
-- archived_at = null（活跃），学期切换时 sync_school_course_archives() 触发器
-- 会照常在下次切换时把它归档，这里不需要预判。
--
-- 并发处理：两名学生同时第一次加入同一门课时，两次 after insert on
-- course_members 触发都会判断"还没有会话"，都可能尝试创建，从而在
-- course_conversations 的唯一约束（course_id 唯一）上互相打架。用
-- `select ... from public.courses where id = new.course_id for update`
-- 给这门课的 courses 行加锁来串行化：先拿到锁的事务建好会话并提交，后到的
-- 事务在等锁期间看不到新会话，拿到锁之后重新查一次 course_conversations
-- 就会发现会话已经存在，转而只插入 conversation_members。锁的对象选
-- courses 行而不是 course_conversations 行：后者此前还不存在，没法锁一行
-- 不存在的记录；courses 行必然已经存在（course_members.course_id 有外键
-- 约束）。这把锁不会和 courses_delete_owned_conversation（before delete on
-- courses）产生死锁：删除同一门课本身也需要这一行的写锁，两个事务只是谁先
-- 谁后顺序执行，不存在循环等待。退出课程（DELETE 分支）不需要加这把锁：
-- 会话此时必然已经存在（有成员才能退出），只做查找 + 删除。

begin;

-- ---------------------------------------------------------------------------
-- 1. 一次性清理：现有的"建课时就建、但从来没人加入过"的空课程会话
-- ---------------------------------------------------------------------------
-- 只删 course_conversations 关联的 conversations 行里，当前 0 个
-- conversation_members 的那些；已经有成员的课程会话不受影响。
-- course_conversations.conversation_id 外键是 on delete cascade，删掉
-- conversations 行会自动带走对应的 course_conversations 行。
delete from public.conversations
using public.course_conversations
where conversations.id = course_conversations.conversation_id
  and not exists (
    select 1
    from public.conversation_members
    where conversation_members.conversation_id = course_conversations.conversation_id
  );

-- ---------------------------------------------------------------------------
-- 2. 建课不再自动建会话
-- ---------------------------------------------------------------------------
drop trigger if exists courses_auto_create_conversation on public.courses;
drop function if exists public.create_conversation_for_course();

-- ---------------------------------------------------------------------------
-- 3. 第一个学生加入时才惰性建会话
-- ---------------------------------------------------------------------------
create or replace function public.sync_course_conversation_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation uuid;
begin
  if tg_op = 'INSERT' then
    -- 锁住这门课的 courses 行，串行化并发的"第一次加入"。
    perform 1 from public.courses where id = new.course_id for update;

    select conversation_id into target_conversation
    from public.course_conversations
    where course_id = new.course_id;

    if target_conversation is null then
      insert into public.conversations (kind)
      values ('course')
      returning id into target_conversation;

      insert into public.course_conversations (conversation_id, course_id)
      values (target_conversation, new.course_id);
    end if;

    insert into public.conversation_members (conversation_id, user_id, joined_at)
    values (target_conversation, new.user_id, new.joined_at)
    on conflict do nothing;
    return new;
  end if;

  select conversation_id into target_conversation
  from public.course_conversations
  where course_id = old.course_id;

  -- 正常情况下这里必然能找到会话（有成员才能退出）；null 分支只是防御。
  if target_conversation is not null then
    delete from public.conversation_members
    where conversation_id = target_conversation and user_id = old.user_id;
  end if;
  return old;
end;
$$;

commit;
