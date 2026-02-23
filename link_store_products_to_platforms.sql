-- Vincula produtos da loja às plataformas para exibir preços na vitrine
-- Execute no Supabase SQL Editor após os seeds.

with platform_keys as (
  select
    p.id as platform_id,
    lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', '', 'g')) as platform_key
  from public.platforms_public p
  where p.status = 'active'
),
product_keys as (
  select
    sp.id as store_product_id,
    lower(regexp_replace(coalesce(sp.slug, sp.name, ''), '[^a-z0-9]+', '', 'g')) as product_key,
    sp.metadata
  from public.store_products sp
  where sp.is_active = true
)
update public.store_products sp
set metadata = coalesce(sp.metadata, '{}'::jsonb) || jsonb_build_object('platform_id', pk.platform_id)
from product_keys sk
join platform_keys pk on pk.platform_key = sk.product_key
where sp.id = sk.store_product_id
  and (
    sp.metadata is null
    or (sp.metadata->>'platform_id') is null
    or (sp.metadata->>'platform_id') = ''
  );

-- Verificação de itens ainda sem vínculo
select
  sp.id,
  sp.slug,
  sp.name,
  sp.metadata->>'platform_id' as platform_id
from public.store_products sp
where sp.is_active = true
  and (
    sp.metadata is null
    or (sp.metadata->>'platform_id') is null
    or (sp.metadata->>'platform_id') = ''
  )
order by sp.sort_order, sp.name;
