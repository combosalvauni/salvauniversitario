-- Restaura/reativa Globo Pay sem duplicar registros
-- Execute no Supabase SQL Editor

-- 1) Plataforma
with updated as (
  update public.platforms
  set
    name = 'Globo Pay',
    description = 'O Globoplay é a plataforma digital de streaming de vídeos e áudios sob demanda do Grupo Globo',
    image_url = 'https://i.ibb.co/pBbf9S2W/globo-pay.png',
    status = 'active'
  where lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay')
  returning id
), inserted as (
  insert into public.platforms (name, description, image_url, status)
  select
    'Globo Pay',
    'O Globoplay é a plataforma digital de streaming de vídeos e áudios sob demanda do Grupo Globo',
    'https://i.ibb.co/pBbf9S2W/globo-pay.png',
    'active'
  where not exists (select 1 from updated)
  returning id
)
select coalesce((select id from updated limit 1), (select id from inserted limit 1)) as platform_id;

-- 2) Produto da loja vinculado à plataforma (reativa se já existir)
with platform_ref as (
  select id as platform_id
  from public.platforms
  where lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay')
  order by created_at asc
  limit 1
), updated_store as (
  update public.store_products sp
  set
    slug = 'globopay',
    name = 'Globo Pay',
    description = coalesce(sp.description, 'Acesso Globo Pay'),
    product_type = coalesce(sp.product_type, 'acesso'),
    is_active = true,
    is_visible = true,
    metadata = (
      (coalesce(sp.metadata, '{}'::jsonb) - 'removed_from_store') ||
      jsonb_build_object('platform_id', (select platform_id from platform_ref))
    )
  where (
      lower(regexp_replace(coalesce(sp.slug, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay')
      or lower(regexp_replace(coalesce(sp.name, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay')
      or (sp.metadata->>'platform_id') = (select platform_id::text from platform_ref)
    )
  returning sp.id
)
insert into public.store_products (
  slug,
  name,
  description,
  product_type,
  credit_cost,
  allow_multiple_units,
  is_highlight,
  is_active,
  is_visible,
  sort_order,
  metadata
)
select
  'globopay',
  'Globo Pay',
  'Acesso Globo Pay',
  'acesso',
  0,
  false,
  false,
  true,
  true,
  999,
  jsonb_build_object('platform_id', (select platform_id from platform_ref))
where exists (select 1 from platform_ref)
  and not exists (select 1 from updated_store)
  and not exists (
    select 1
    from public.store_products sp
    where (sp.metadata->>'platform_id') = (select platform_id::text from platform_ref)
  );

-- 3) Verificação
select id, name, status, image_url
from public.platforms
where lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay');

select id, slug, name, is_active, is_visible, metadata->>'platform_id' as platform_id
from public.store_products
where lower(regexp_replace(coalesce(slug, name, ''), '[^a-z0-9]+', '', 'g')) in ('globopay', 'globoplay')
order by created_at desc;
