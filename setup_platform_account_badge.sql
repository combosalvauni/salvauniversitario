-- Add manual account counter display config per platform
alter table public.platforms add column if not exists is_visible boolean;
alter table public.platforms add column if not exists show_account_badge boolean;
alter table public.platforms add column if not exists account_badge_count integer;

update public.platforms set is_visible = true where is_visible is null;
update public.platforms set show_account_badge = false where show_account_badge is null;
update public.platforms set account_badge_count = 0 where account_badge_count is null;

alter table public.platforms alter column is_visible set default true;
alter table public.platforms alter column is_visible set not null;
alter table public.platforms alter column show_account_badge set default false;
alter table public.platforms alter column show_account_badge set not null;
alter table public.platforms alter column account_badge_count set default 0;
alter table public.platforms alter column account_badge_count set not null;

drop view if exists public.platforms_public;

create view public.platforms_public as
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
