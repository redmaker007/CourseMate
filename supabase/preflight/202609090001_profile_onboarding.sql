-- Run this read-only audit before applying 202609090001_profile_onboarding.sql.
-- Existing invalid rows are preserved by the migration but their owners will be
-- forced through onboarding until they correct the display name.
select count(*)::int as invalid_profile_count
from public.profiles
where char_length(trim(display_name)) not between 1 and 15;

select
  id,
  char_length(trim(display_name))::int as display_name_length
from public.profiles
where char_length(trim(display_name)) not between 1 and 15
order by id;
