-- 成员会话读取合并为一次调用。
--
-- 每个受保护请求要在 proxy 里、每次页面渲染要在页面里各校验一次成员会话。此前是
-- member_accounts、enabled_school_id_for_email_domain、has_completed_onboarding、
-- current_school_id 四次独立往返（页面里还多一次重复的 auth.getUser），而且串行，
-- 每次往返都要跨一次网络。这个函数只是把这四个已有读取包成一次调用：
--
--   · 不引入新的数据来源，也不放宽任何可见性。绑定仍然经 member_accounts 的 RLS 读取
--     （security invoker），只能读到调用者自己的那一行；其余三项本来就是已授权给
--     authenticated 的函数。
--   · 没有成员账号时返回零行，等同于原来读不到绑定。
--   · 邮箱域名由调用方传入（来自服务端已验证的 Auth 用户），函数不信任任何客户端身份，
--     身份只取 auth.uid()。
--
-- 只新增函数，旧前端不调用它，所以必须先于新前端应用（先应用迁移，再发布前端）。
begin;

create function public.get_member_context(candidate_domain text)
returns table (
  user_id uuid,
  home_school_id text,
  enabled_school_id text,
  current_school_id text,
  onboarding_complete boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    member.user_id,
    member.school_id,
    public.enabled_school_id_for_email_domain(candidate_domain),
    public.current_school_id(),
    public.has_completed_onboarding()
  from public.member_accounts member
  where member.user_id = (select auth.uid());
$$;

-- 与其他函数一样显式收回三个角色，再只授予已登录用户（见 202609100005 的教训）。
revoke all on function public.get_member_context(text) from public, anon, authenticated;
grant execute on function public.get_member_context(text) to authenticated;

commit;
