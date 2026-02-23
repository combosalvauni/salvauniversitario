-- Ativa controle de visibilidade de plataformas no Admin
-- Execute no Supabase SQL Editor

alter table public.platforms
  add column if not exists is_visible boolean default true not null;

update public.platforms
set is_visible = true
where is_visible is null;

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
