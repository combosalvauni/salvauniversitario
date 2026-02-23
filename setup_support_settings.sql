-- SUPPORT SETTINGS (singleton editable by admin)
create table if not exists public.support_settings (
  id boolean primary key default true check (id = true),
  email_title text default 'E-mail de Suporte',
  email_value text default 'contato@concursaflix.com',
  email_button_text text default 'Entrar em Contato',
  email_url text default 'mailto:contato@concursaflix.com',
  whatsapp_title text default 'WhatsApp',
  whatsapp_value text default '55 16 99885-9608',
  whatsapp_button_text text default 'Entrar em Contato',
  whatsapp_url text default 'https://wa.me/5516998859608',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

insert into public.support_settings (id)
select true
where not exists (select 1 from public.support_settings where id = true);

alter table public.support_settings enable row level security;

drop policy if exists "Authenticated users can view support settings" on public.support_settings;
drop policy if exists "Admins can manage support settings" on public.support_settings;

create policy "Authenticated users can view support settings"
  on public.support_settings for select
  to authenticated
  using (true);

create policy "Admins can manage support settings"
  on public.support_settings for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
