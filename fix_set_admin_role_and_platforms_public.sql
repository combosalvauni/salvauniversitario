-- Fixes for running the old admin/platform migration on databases that already
-- have the current platforms_public view shape.

create extension if not exists "uuid-ossp";

do $$
declare
  v_admin_email text := 'admin@concursaflix.com';
begin
  if exists (
    select 1
    from auth.users
    where lower(email) = lower(v_admin_email)
  ) then
    perform public.make_admin(v_admin_email);
    raise notice '[OK] Admin privileges ensured for %', v_admin_email;
  else
    raise notice '[SKIP] User % not found in auth.users. Create the auth user first and rerun only the make_admin step if needed.', v_admin_email;
  end if;
end $$;

drop view if exists public.platforms_public;

create view public.platforms_public
with (security_invoker = true) as
select
  p.id,
  p.name,
  p.description,
  p.image_url,
  p.status,
  p.is_visible,
  p.extension_link,
  p.created_at,
  p.sort_order,
  p.show_account_badge,
  p.account_badge_count,
  (
    select count(*)::int
    from public.platform_accounts pa
    where pa.platform_id = p.id
      and pa.status = 'active'
  ) as active_accounts_count
from public.platforms p;

grant select on public.platforms_public to authenticated;

notify pgrst, 'reload schema';