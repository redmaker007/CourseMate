create table public.schools (
  id text primary key,
  name_zh text not null,
  name_en text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint schools_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table public.school_email_domains (
  domain text primary key,
  school_id text not null references public.schools(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint school_email_domains_normalized check (
    domain = lower(btrim(domain))
    and domain ~ '^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$'
  )
);

create index school_email_domains_school_id_idx
  on public.school_email_domains(school_id);

-- Ticket #2 needs to distinguish a real CourseMate member session from an
-- Auth-only session. Automatic creation of these bindings belongs to Ticket #3.
create table public.member_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_id text not null references public.schools(id),
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;
alter table public.school_email_domains enable row level security;
alter table public.member_accounts enable row level security;

grant select on public.schools, public.school_email_domains
  to anon, authenticated;
grant select on public.member_accounts
  to authenticated;

create policy "enabled schools are publicly readable"
  on public.schools for select to anon, authenticated
  using (enabled);

create policy "enabled school domains are publicly readable"
  on public.school_email_domains for select to anon, authenticated
  using (
    exists (
      select 1 from public.schools
      where schools.id = school_email_domains.school_id and schools.enabled
    )
  );

create policy "members can read their own school binding"
  on public.member_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

insert into public.schools (id, name_zh, name_en, enabled)
values (
  'uw-madison',
  '威斯康星大学麦迪逊分校',
  'University of Wisconsin–Madison',
  true
);

insert into public.school_email_domains (domain, school_id)
values ('wisc.edu', 'uw-madison');

-- This is the single database definition of an enabled exact email domain.
-- The application compares the returned school id with the user's selection;
-- the Auth hook uses the same result to guard direct public Auth requests.
create or replace function public.enabled_school_id_for_email_domain(candidate_domain text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select domains.school_id
  from public.school_email_domains domains
  join public.schools schools on schools.id = domains.school_id
  where domains.domain = lower(btrim(candidate_domain))
    and schools.enabled
  limit 1
$$;

revoke execute
  on function public.enabled_school_id_for_email_domain(text)
  from public;
grant execute
  on function public.enabled_school_id_for_email_domain(text)
  to anon, authenticated, supabase_auth_admin;

-- Configure this function as the Supabase Auth "Before User Created" hook.
-- Both the application and this guard read the same database allowlist.
create or replace function public.hook_restrict_user_to_enabled_school(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate_email text := btrim(event->'user'->>'email');
  candidate_domain text;
begin
  if candidate_email is null
    or candidate_email = ''
    or length(candidate_email) - length(replace(candidate_email, '@', '')) <> 1
  then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Email is not eligible for an enabled school.'
      )
    );
  end if;

  candidate_domain := lower(split_part(candidate_email, '@', 2));

  if public.enabled_school_id_for_email_domain(candidate_domain) is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Email is not eligible for an enabled school.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke execute
  on function public.hook_restrict_user_to_enabled_school(jsonb)
  from public, anon, authenticated;
grant execute
  on function public.hook_restrict_user_to_enabled_school(jsonb)
  to supabase_auth_admin;

comment on function public.hook_restrict_user_to_enabled_school(jsonb) is
  'Supabase Before User Created hook enforcing enabled exact school email domains.';
