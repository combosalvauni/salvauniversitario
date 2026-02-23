-- Controle de acesso da Loja por usuário (menu + rota)
-- Execute no Supabase SQL Editor

alter table public.profiles
  add column if not exists can_access_store boolean default false not null;

update public.profiles
set can_access_store = false
where can_access_store is null;
