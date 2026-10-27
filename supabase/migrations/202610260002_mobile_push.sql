begin;

-- 与网页订阅／去重记录分开；账号删除通过成员外键清除设备及待发送任务。
create table public.mobile_push_devices (
  installation_id uuid primary key,
  user_id uuid not null references public.member_accounts(user_id) on delete cascade,
  session_id uuid not null,
  device_token text not null unique check (device_token ~ '^[0-9a-f]+$' and length(device_token) between 32 and 512 and length(device_token)%2=0),
  environment text not null check (environment in ('sandbox','production')),
  updated_at timestamptz not null default now()
);
create index mobile_push_devices_user_idx on public.mobile_push_devices(user_id,session_id);
create table public.mobile_push_jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.mobile_push_devices(installation_id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  created_at timestamptz not null default now(),
  unique (installation_id,message_id)
);
create index mobile_push_jobs_ready_idx on public.mobile_push_jobs(state,available_at);
create index mobile_push_jobs_message_idx on public.mobile_push_jobs(message_id);
create index mobile_push_jobs_age_idx on public.mobile_push_jobs(created_at);
alter table public.mobile_push_devices enable row level security;
alter table public.mobile_push_jobs enable row level security;
revoke all on public.mobile_push_devices,public.mobile_push_jobs from public,anon,authenticated,service_role;

create function public.register_mobile_push_device(target_installation uuid,target_token text,target_environment text default 'sandbox')
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  sid uuid := (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid;
  changed_installation uuid;
begin
  if actor is null or sid is null or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=actor
      and coalesce((to_jsonb(s)->>'not_after')::timestamptz>now(),true))
    or not public.has_completed_onboarding() or public.current_school_id() is null then
    raise exception 'valid_member_session_required' using errcode='42501';
  end if;
  if not exists(select 1 from public.member_accounts a join auth.users u on u.id=a.user_id
      join public.schools current_school on current_school.id=public.current_school_id() and current_school.enabled
      where a.user_id=actor and u.email_confirmed_at is not null
        and public.enabled_school_id_for_email_domain(split_part(u.email,'@',2))=a.school_id) then
    raise exception 'valid_member_session_required' using errcode='42501';
  end if;
  if target_installation is null or target_token is null or target_token !~ '^[0-9a-fA-F]+$' or length(target_token) not between 32 and 512
    or length(target_token)%2<>0 or target_environment not in ('sandbox','production') or target_environment is null then
    raise exception 'invalid_device' using errcode='22023';
  end if;
  -- 锁住账号，避免并发登记绕过设备上限；token 只由原生系统提供，不进入日志。
  perform 1 from public.member_accounts where user_id=actor for update;
  if (select count(*) from public.mobile_push_devices where user_id=actor and installation_id<>target_installation)>=10 then
    return 'device_limit_reached';
  end if;
  delete from public.mobile_push_devices where device_token=lower(target_token) and installation_id<>target_installation;
  insert into public.mobile_push_devices as d(installation_id,user_id,session_id,device_token,environment)
    values(target_installation,actor,sid,lower(target_token),target_environment)
  on conflict(installation_id) do update set user_id=excluded.user_id,session_id=excluded.session_id,
    device_token=excluded.device_token,environment=excluded.environment,updated_at=now()
    where (d.user_id,d.session_id,d.device_token,d.environment) is distinct from
      (excluded.user_id,excluded.session_id,excluded.device_token,excluded.environment)
    returning d.installation_id into changed_installation;
  -- 只有实际改绑才丢弃旧任务；幂等登记不能抹掉待投递或待重试通知。
  if changed_installation is not null then
    delete from public.mobile_push_jobs where installation_id=changed_installation;
  end if;
  return 'registered';
end; $$;

create function public.remove_mobile_push_device(target_installation uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare sid uuid := (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid;
begin
  if auth.uid() is null or sid is null then raise exception 'session_required' using errcode='42501'; end if;
  delete from public.mobile_push_devices where user_id=auth.uid() and session_id=sid
    and (target_installation is null or installation_id=target_installation);
  return 'removed';
end; $$;

-- 只供内部领取任务；不通过调用者提供的收件人、正文或发送者决定投递。
create function public.mobile_push_eligible(target_message bigint,target_installation uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists(
    select 1 from public.messages m
    join public.direct_conversations c on c.conversation_id=m.conversation_id and m.sender_id in(c.member_low,c.member_high)
    join public.mobile_push_devices d on d.installation_id=target_installation
      and d.user_id=case when m.sender_id=c.member_low then c.member_high else c.member_low end
    join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
      and coalesce((to_jsonb(s)->>'not_after')::timestamptz>now(),true)
    join public.conversation_members cm on cm.conversation_id=c.conversation_id and cm.user_id=d.user_id
      and m.id>coalesce(cm.cleared_through_message_id,0)
    join public.friendships f on f.pair_low=c.member_low and f.pair_high=c.member_high and f.active
    join public.profiles sender on sender.id=m.sender_id and char_length(trim(sender.display_name)) between 1 and 15
    join public.profiles recipient on recipient.id=d.user_id and char_length(trim(recipient.display_name)) between 1 and 15
    join public.member_accounts sender_member on sender_member.user_id=m.sender_id
    join public.member_accounts recipient_member on recipient_member.user_id=d.user_id
    join public.schools current_school on current_school.id=public.effective_member_school_id(d.user_id) and current_school.enabled
    join auth.users sender_auth on sender_auth.id=m.sender_id and sender_auth.email_confirmed_at is not null
    join auth.users recipient_auth on recipient_auth.id=d.user_id and recipient_auth.email_confirmed_at is not null
    where m.id=target_message and m.deleted_at is null and m.sender_id is not null
      and m.created_at>now()-interval '5 minutes'
      and public.enabled_school_id_for_email_domain(split_part(sender_auth.email,'@',2))=sender_member.school_id
      and public.enabled_school_id_for_email_domain(split_part(recipient_auth.email,'@',2))=recipient_member.school_id
      and public.effective_member_school_id(m.sender_id)=public.effective_member_school_id(d.user_id)
      and not public.members_are_blocked(m.sender_id,d.user_id)
      and not exists(select 1 from public.friend_preferences p where p.pair_low=c.member_low and p.pair_high=c.member_high and p.owner_id=d.user_id and p.hidden)
  );
end; $$;

create function public.enqueue_mobile_direct_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
  select case when new.sender_id=c.member_low then c.member_high else c.member_low end into recipient
    from public.direct_conversations c where c.conversation_id=new.conversation_id
      and new.sender_id in(c.member_low,c.member_high);
  if recipient is not null then
    insert into public.mobile_push_jobs(installation_id,message_id)
    select d.installation_id,new.id from public.mobile_push_devices d
      where d.user_id=recipient and public.mobile_push_eligible(new.id,d.installation_id)
    on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger enqueue_mobile_direct_push after insert on public.messages
  for each row execute function public.enqueue_mobile_direct_push();

create function public.claim_mobile_push_jobs(batch_size integer default 5,target_environment text default 'sandbox')
returns table(job_id uuid,lease uuid,device_token text,recipient_id uuid,conversation_id uuid,sender_name text)
language plpgsql security definer set search_path = '' as $$
declare job record; lease_token uuid;
begin
  if batch_size is null or batch_size not between 1 and 5 or target_environment not in ('sandbox','production') then
    raise exception 'invalid_batch' using errcode='22023';
  end if;
  delete from public.mobile_push_jobs where id in (select j.id from public.mobile_push_jobs j where j.created_at<now()-interval '7 days' limit 500);
  for job in select j.* from public.mobile_push_jobs j
    join public.mobile_push_devices d on d.installation_id=j.installation_id and d.environment=target_environment
    where j.state in ('pending','sending') and j.available_at<=now()
    order by j.available_at,j.id limit batch_size for update of j skip locked
  loop
    if job.attempts>=4 or not public.mobile_push_eligible(job.message_id,job.installation_id) then
      update public.mobile_push_jobs set state='skipped',lease_id=null where id=job.id;
    else
      lease_token:=gen_random_uuid();
      update public.mobile_push_jobs set state='sending',attempts=attempts+1,
        lease_id=lease_token,available_at=now()+interval '60 seconds' where id=job.id;
      return query select job.id,lease_token,d.device_token,d.user_id,m.conversation_id,p.display_name
        from public.mobile_push_devices d join public.messages m on m.id=job.message_id
        join public.profiles p on p.id=m.sender_id where d.installation_id=job.installation_id;
    end if;
  end loop;
end; $$;

create function public.finish_mobile_push_job(target_job uuid,target_lease uuid,outcome text)
returns text language plpgsql security definer set search_path = '' as $$
declare job public.mobile_push_jobs%rowtype;
begin
  if outcome not in ('sent','retry','invalid_token','failed') or outcome is null then raise exception 'invalid_outcome'; end if;
  select * into job from public.mobile_push_jobs where id=target_job and lease_id=target_lease and state='sending' for update;
  if not found then return 'stale'; end if;
  if outcome='invalid_token' then
    delete from public.mobile_push_devices where installation_id=job.installation_id;
  else
    update public.mobile_push_jobs set state=case when outcome='retry' and attempts<4 then 'pending' when outcome='sent' then 'sent' else 'failed' end,
      lease_id=null,available_at=now()+make_interval(secs=>least(120,15*attempts*attempts)) where id=job.id;
  end if;
  return 'recorded';
end; $$;

revoke all on function public.register_mobile_push_device(uuid,text,text),public.remove_mobile_push_device(uuid),
  public.mobile_push_eligible(bigint,uuid),public.enqueue_mobile_direct_push(),
  public.claim_mobile_push_jobs(integer,text),public.finish_mobile_push_job(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.register_mobile_push_device(uuid,text,text),public.remove_mobile_push_device(uuid) to authenticated;
grant execute on function public.claim_mobile_push_jobs(integer,text),public.finish_mobile_push_job(uuid,uuid,text) to service_role;
commit;
