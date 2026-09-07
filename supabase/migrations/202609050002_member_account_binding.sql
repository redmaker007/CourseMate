create or replace function public.bind_verified_email_to_member_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_email text := btrim(new.email);
  candidate_domain text;
  derived_school_id text;
  existing_school_id text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  if candidate_email is null
    or candidate_email = ''
    or length(candidate_email) - length(replace(candidate_email, '@', '')) <> 1
  then
    raise exception 'Verified Auth email has no eligible school domain.'
      using errcode = 'check_violation';
  end if;

  candidate_domain := lower(split_part(candidate_email, '@', 2));
  derived_school_id := public.enabled_school_id_for_email_domain(candidate_domain);

  if derived_school_id is null then
    raise exception 'Verified Auth email has no eligible school domain.'
      using errcode = 'check_violation';
  end if;

  insert into public.member_accounts (user_id, school_id)
  values (new.id, derived_school_id)
  on conflict (user_id) do nothing;

  select member_accounts.school_id
  into existing_school_id
  from public.member_accounts
  where member_accounts.user_id = new.id;

  if existing_school_id is distinct from derived_school_id then
    raise exception 'Auth user has a conflicting school binding.'
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end;
$$;

revoke execute
  on function public.bind_verified_email_to_member_account()
  from public, anon, authenticated;

create trigger bind_member_account_after_email_confirmation
after insert or update of email_confirmed_at on auth.users
for each row
when (new.email_confirmed_at is not null)
execute function public.bind_verified_email_to_member_account();

create or replace function public.reject_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'Changing the CourseMate login email is not supported.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute
  on function public.reject_auth_email_change()
  from public, anon, authenticated;

create trigger reject_course_mate_auth_email_change
before update of email on auth.users
for each row
execute function public.reject_auth_email_change();
