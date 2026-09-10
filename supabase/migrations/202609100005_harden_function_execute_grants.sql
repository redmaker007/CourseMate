-- 收紧函数执行权
--
-- Supabase 会通过 default privileges 把 public schema 里新建函数的 EXECUTE 权限
-- **单独授予 anon 与 authenticated**。而此前所有 migration 都只写了
-- `revoke execute ... from public`——那只收回了 PUBLIC 这一级，收不回这两份单独
-- 的授权。结果是：
--
--   · 本意只给已登录用户的函数，未登录用户也能调用
--   · 本意只在内部使用、没有授予任何人的辅助函数，任何客户端都能直接调用
--
-- 第二类里有一个真正的泄露点：members_are_blocked(a, b) 不校验调用者是谁，传入
-- 任意两个成员 ID 就返回两人之间有没有拉黑。
--
-- 线上实测确认过这个行为：用未登录身份调用只授予了 authenticated 的
-- can_access_course_conversation，得到的是 false，而不是权限拒绝。
--
-- 本地 PGlite 测试此前只复刻了表的 default privileges，没有复刻函数的，所以一直
-- 没发现。course-catalog-integration.test.ts 已补上，并且先断言修复前漏洞确实存在。

begin;

-- ---------------------------------------------------------------------------
-- 1. 根因：以后新建的函数不再自动授予 anon / authenticated
-- ---------------------------------------------------------------------------
-- 所有 migration 都显式 grant 给需要的角色，从不依赖自动授予，所以收回默认值不影响
-- 任何现有写法，只是让「revoke from public」这种写法重新变得充分。
--
-- 同时写按 schema 和全局两种：不确定 Supabase 的默认授权挂在哪一级，没有对应授权时
-- revoke 是空操作，两条都写没有副作用。
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 未登录用户：除登录必需的那一个之外，全部收回
-- ---------------------------------------------------------------------------
-- enabled_school_id_for_email_domain 不在列表里：登录页在用户登录前就要调用它，
-- 202609050001 本来就是有意授予 anon 的。
--
-- 收回 anon 不影响任何 RLS 策略：唯一面向 anon 的策略（开放学校列表）不调用函数。
-- 应用代码里调用这些函数的地方（session.ts 的 has_completed_onboarding、个人资料页
-- 的 get_own_profile）都在确认已登录之后。
revoke execute on function
  public.current_school_id(),
  public.is_course_member(uuid),
  public.shares_course_with(uuid),
  public.has_completed_onboarding(),
  public.can_access_course_conversation(uuid),
  public.can_send_to_course_conversation(uuid),
  public.find_member_by_email(text),
  public.friend_relationship_status(uuid),
  public.get_own_profile(),
  public.list_friend_requests(),
  public.list_friends(boolean),
  public.remove_friend(uuid),
  public.respond_to_friend_request(uuid, text),
  public.send_friend_request(uuid, text),
  public.set_friend_hidden(uuid, boolean),
  public.set_friend_note(uuid, text),
  public.set_member_blocked(uuid, boolean)
from anon;

-- ---------------------------------------------------------------------------
-- 3. 内部辅助函数：已登录用户也收回
-- ---------------------------------------------------------------------------
-- 这两个只被其他 SECURITY DEFINER 函数在内部调用——那时以函数属主身份执行，不需要
-- 调用者有执行权——也没有任何 RLS 策略用到它们，所以收回不影响功能。
--
-- members_are_blocked 是真正的泄露点，它不校验调用者。consume_friend_rate_limit
-- 按 auth.uid() 计数，直接调用只会消耗调用者自己的额度，但本来就不该对客户端开放。
revoke execute on function
  public.members_are_blocked(uuid, uuid),
  public.consume_friend_rate_limit(text)
from anon, authenticated;

-- 触发器函数不在以上列表里：PostgREST 不暴露返回 trigger 的函数，直接调用也会报错。
-- 为了不冒影响触发器触发的风险，这里不动它们。

commit;
