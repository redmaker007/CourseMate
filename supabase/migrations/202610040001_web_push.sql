-- 网页推送：订阅存储与"谁该收到通知"的判定。
-- 订阅只能由本人写入；服务端发送器（service_role）通过下面两个受限函数取收件人订阅，
-- 函数自己从数据库推导收件人并复查关系，调用方不能指定"发给谁"。

begin;

create table public.push_subscriptions (
  endpoint text primary key
    check (char_length(endpoint) between 1 and 2048 and endpoint like 'https://%'),
  user_id uuid not null
    references public.member_accounts(user_id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth_secret text not null check (char_length(auth_secret) between 1 and 128),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id, created_at desc);

-- 每个事件只通知一次：重试发送、重复提交都不会重复推送。
create table public.push_dispatches (
  event_key text primary key,
  created_at timestamptz not null default now()
);

create index push_dispatches_created_idx
  on public.push_dispatches (created_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_dispatches enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_dispatches from public, anon, authenticated;

-- 本人保存订阅。同一个浏览器换账号登录时，订阅归当前账号。
create or replace function public.save_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text
)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not public.has_completed_onboarding() then
    return 'onboarding_required';
  end if;

  if target_endpoint is null
     or char_length(target_endpoint) > 2048
     or target_endpoint not like 'https://%'
     or target_p256dh is null
     or char_length(target_p256dh) not between 1 and 256
     or target_auth is null
     or char_length(target_auth) not between 1 and 128 then
    return 'invalid';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth_secret)
  values (target_endpoint, actor, target_p256dh, target_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        created_at = now();

  -- 每人最多保留 10 个设备，超出的删最旧的
  delete from public.push_subscriptions subscription
  where subscription.user_id = actor
    and subscription.endpoint in (
      select kept.endpoint
      from public.push_subscriptions kept
      where kept.user_id = actor
      order by kept.created_at desc
      offset 10
    );

  return 'saved';
end;
$$;

create or replace function public.remove_push_subscription(target_endpoint text)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return 'onboarding_required';
  end if;

  delete from public.push_subscriptions subscription
  where subscription.endpoint = target_endpoint
    and subscription.user_id = auth.uid();

  return 'removed';
end;
$$;

-- 私聊新消息：只在"消息刚发出、收件人仍是有效好友、没有拉黑、没有被收件人屏蔽"时返回收件人的订阅。
create or replace function public.claim_push_targets_for_direct_message(
  target_message_id bigint
)
returns table (endpoint text, p256dh text, auth_secret text)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  message_row record;
  recipient uuid;
  low_member uuid;
  high_member uuid;
begin
  select message.sender_id, message.conversation_id
  into message_row
  from public.messages message
  where message.id = target_message_id
    and message.deleted_at is null
    and message.sender_id is not null
    and message.created_at > now() - interval '5 minutes';
  if not found then
    return;
  end if;

  select case
           when direct.member_low = message_row.sender_id then direct.member_high
           else direct.member_low
         end
  into recipient
  from public.direct_conversations direct
  where direct.conversation_id = message_row.conversation_id
    and message_row.sender_id in (direct.member_low, direct.member_high);
  if recipient is null then
    return;
  end if;

  low_member := least(message_row.sender_id, recipient);
  high_member := greatest(message_row.sender_id, recipient);

  if not exists (
       select 1 from public.friendships friendship
       where friendship.pair_low = low_member
         and friendship.pair_high = high_member
         and friendship.active
     )
     or public.members_are_blocked(message_row.sender_id, recipient)
     or exists (
       select 1 from public.friend_preferences preference
       where preference.pair_low = low_member
         and preference.pair_high = high_member
         and preference.owner_id = recipient
         and preference.hidden
     )
     or not exists (
       select 1 from public.profiles profile
       where profile.id = recipient
         and char_length(trim(profile.display_name)) between 1 and 15
     ) then
    return;
  end if;

  insert into public.push_dispatches (event_key)
  values ('direct_message:' || target_message_id)
  on conflict do nothing;
  if not found then
    return;
  end if;

  delete from public.push_dispatches dispatch
  where dispatch.created_at < now() - interval '7 days';

  return query
  select subscription.endpoint, subscription.p256dh, subscription.auth_secret
  from public.push_subscriptions subscription
  where subscription.user_id = recipient;
end;
$$;

-- 好友申请：申请刚发出、仍待处理、双方没有拉黑时，返回收件人的订阅。
create or replace function public.claim_push_targets_for_friend_request(
  target_request_id uuid
)
returns table (endpoint text, p256dh text, auth_secret text)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  request_row record;
begin
  select request.requester_id, request.recipient_id
  into request_row
  from public.friend_requests request
  where request.id = target_request_id
    and request.status = 'pending'
    and request.requester_id is not null
    and request.recipient_id is not null
    and request.created_at > now() - interval '5 minutes';
  if not found then
    return;
  end if;

  if public.members_are_blocked(request_row.requester_id, request_row.recipient_id)
     or not exists (
       select 1 from public.profiles profile
       where profile.id = request_row.recipient_id
         and char_length(trim(profile.display_name)) between 1 and 15
     ) then
    return;
  end if;

  insert into public.push_dispatches (event_key)
  values ('friend_request:' || target_request_id)
  on conflict do nothing;
  if not found then
    return;
  end if;

  delete from public.push_dispatches dispatch
  where dispatch.created_at < now() - interval '7 days';

  return query
  select subscription.endpoint, subscription.p256dh, subscription.auth_secret
  from public.push_subscriptions subscription
  where subscription.user_id = request_row.recipient_id;
end;
$$;

-- 推送服务返回"订阅已失效"（404 / 410）后，由发送器清掉。
create or replace function public.drop_push_subscription(target_endpoint text)
returns void
language sql
security definer
volatile
set search_path = ''
as $$
  delete from public.push_subscriptions subscription
  where subscription.endpoint = target_endpoint;
$$;

revoke execute on function public.save_push_subscription(text, text, text)
  from public, anon;
revoke execute on function public.remove_push_subscription(text)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text)
  to authenticated;
grant execute on function public.remove_push_subscription(text)
  to authenticated;

revoke execute on function public.claim_push_targets_for_direct_message(bigint)
  from public, anon, authenticated;
revoke execute on function public.claim_push_targets_for_friend_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.drop_push_subscription(text)
  from public, anon, authenticated;
grant execute on function public.claim_push_targets_for_direct_message(bigint)
  to service_role;
grant execute on function public.claim_push_targets_for_friend_request(uuid)
  to service_role;
grant execute on function public.drop_push_subscription(text)
  to service_role;

commit;
