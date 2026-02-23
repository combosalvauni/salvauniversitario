-- Persistência do ciclo promocional selecionado no carrinho
-- Execute no Supabase SQL Editor (ambientes já existentes)

alter table public.store_cart_items
  add column if not exists metadata jsonb default '{}'::jsonb not null;

update public.store_cart_items
set metadata = '{}'::jsonb
where metadata is null;

notify pgrst, 'reload schema';
