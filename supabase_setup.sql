-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES TABLE (Public user data linked to Auth)
create table if not exists public.profiles (
  id uuid references auth.users not null primary key,
  email text,
  full_name text,
  whatsapp text,
  avatar_url text,
  role text default 'student', -- 'admin' or 'student'
  subscription_status text default 'teste-gratis', -- 'teste-gratis', 'mensal', 'trimestral', 'semestral', 'anual' (legacy: 'active')
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ensure column exists when running on an already-created table
alter table public.profiles add column if not exists whatsapp text;
alter table public.profiles add column if not exists avatar_url text;

-- AVATARS STORAGE (bucket + policies)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

create policy "Users can upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Helper: check if current user is admin
create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.role = 'admin'
  );
$$;

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

-- SUBSCRIPTION PLANS (editable by admin, visible to authenticated users)
create table if not exists public.subscription_plans (
  id uuid default uuid_generate_v4() primary key,
  slug text unique not null,
  name text not null,
  price_text text not null,
  period_text text,
  features text[] default '{}'::text[] not null,
  badge_text text,
  is_highlight boolean default false not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists subscription_plans_sort_order_idx on public.subscription_plans(sort_order);

alter table public.subscription_plans enable row level security;

drop policy if exists "Authenticated users can view subscription plans" on public.subscription_plans;
drop policy if exists "Admins can manage subscription plans" on public.subscription_plans;

create policy "Authenticated users can view subscription plans"
  on public.subscription_plans for select
  to authenticated
  using (true);

create policy "Admins can manage subscription plans"
  on public.subscription_plans for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.subscription_plans (slug, name, price_text, period_text, features, badge_text, is_highlight, is_active, sort_order)
values
  ('teste-gratis', 'Teste Grátis', 'Grátis', '/3 dias', ARRAY['Acesso limitado', 'Conheça a plataforma', 'Suporte básico'], null, false, true, 10),
  ('mensal', 'Plano Mensal', 'R$ 39,90', '/mês', ARRAY['Acesso a todas as plataformas premium', 'Suporte prioritário', 'Atualizações automáticas'], null, false, true, 20),
  ('trimestral', 'Plano Trimestral', 'R$ 94,90', '/3 meses', ARRAY['Tudo do Plano Mensal', 'Economia de 21%', 'Acesso prioritário a novos cursos'], 'Melhor', true, true, 30),
  ('semestral', 'Plano Semestral', 'R$ 159,90', '/6 meses', ARRAY['Streaming', 'Acesso a 10 IAs GPT professores + Afiliação', 'Tudo do Plano Trimestral'], null, false, true, 40),
  ('anual', 'Plano Anual', 'R$ 297,90', '/1 ano', ARRAY['Tudo do Plano Semestral', 'Melhor custo-benefício anual', 'Suporte prioritário'], null, false, true, 50)
on conflict (slug) do nothing;

-- Enable RLS for profiles
alter table public.profiles enable row level security;

-- PROFILES RLS
-- Users can view/update their own row; admins can view/update any row.
-- NOTE: Preventing changes to privileged columns (role/subscription_status) is done via trigger in setup_triggers.sql

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Admins can update any profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using ( auth.uid() = id );

create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using ( public.is_admin(auth.uid()) );

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (
    auth.uid() = id
    and role = 'student'
    and subscription_status = 'teste-gratis'
    and email = (auth.jwt() ->> 'email')
  );

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ( auth.uid() = id )
  with check ( auth.uid() = id );

create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

-- PLATFORMS TABLE (Courses)
create table if not exists public.platforms (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  image_url text,
  sort_order integer default 0 not null,
  status text default 'active', -- 'active', 'inactive'
  is_visible boolean default true not null,
  show_account_badge boolean default false not null,
  account_badge_count integer default 0 not null,
  access_email text,
  access_password text,
  extension_link text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ensure column exists when running on an already-created table
alter table public.platforms add column if not exists sort_order integer;
alter table public.platforms add column if not exists is_visible boolean;
alter table public.platforms add column if not exists show_account_badge boolean;
alter table public.platforms add column if not exists account_badge_count integer;
update public.platforms set sort_order = 0 where sort_order is null;
update public.platforms set is_visible = true where is_visible is null;
update public.platforms set show_account_badge = false where show_account_badge is null;
update public.platforms set account_badge_count = 0 where account_badge_count is null;
alter table public.platforms alter column sort_order set default 0;
alter table public.platforms alter column sort_order set not null;
alter table public.platforms alter column is_visible set default true;
alter table public.platforms alter column is_visible set not null;
alter table public.platforms alter column show_account_badge set default false;
alter table public.platforms alter column show_account_badge set not null;
alter table public.platforms alter column account_badge_count set default 0;
alter table public.platforms alter column account_badge_count set not null;
create index if not exists platforms_sort_order_idx on public.platforms(sort_order);

-- USER -> PLATFORM ACCESS (per-user permissions)
create table if not exists public.user_platform_access (
  profile_id uuid references public.profiles(id) on delete cascade not null,
  platform_id uuid references public.platforms(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (profile_id, platform_id)
);

-- MIGRATION: allow multiple access grants per (user, platform) with custom dates
-- Convert PK(profile_id, platform_id) -> PK(id) and add validity fields.
alter table public.user_platform_access add column if not exists id uuid;
update public.user_platform_access set id = uuid_generate_v4() where id is null;
alter table public.user_platform_access alter column id set default uuid_generate_v4();
alter table public.user_platform_access alter column id set not null;

alter table public.user_platform_access add column if not exists valid_from timestamp with time zone;
update public.user_platform_access set valid_from = created_at where valid_from is null;
alter table public.user_platform_access alter column valid_from set default timezone('utc'::text, now());
alter table public.user_platform_access alter column valid_from set not null;

alter table public.user_platform_access add column if not exists valid_until timestamp with time zone;
alter table public.user_platform_access add column if not exists revoked_at timestamp with time zone;
alter table public.user_platform_access add column if not exists granted_by uuid references public.profiles(id);
alter table public.user_platform_access add column if not exists note text;

-- Replace the old primary key if it exists (default name is user_platform_access_pkey)
alter table public.user_platform_access drop constraint if exists user_platform_access_pkey;
alter table public.user_platform_access add constraint user_platform_access_pkey primary key (id);

create index if not exists user_platform_access_profile_platform_idx
  on public.user_platform_access(profile_id, platform_id);

-- Enable RLS for platforms
alter table public.platforms enable row level security;

alter table public.user_platform_access enable row level security;

-- PLATFORM ACCOUNTS (multiple logins per platform)
create table if not exists public.platform_accounts (
  id uuid default uuid_generate_v4() primary key,
  platform_id uuid references public.platforms(id) on delete cascade not null,
  label text not null default 'Padrão',
  access_email text,
  access_password text,
  extension_link text,
  status text default 'active', -- 'active', 'inactive'
  max_seats integer,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.platform_account_assignments (
  id uuid default uuid_generate_v4() primary key,
  account_id uuid references public.platform_accounts(id) on delete cascade not null,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  valid_from timestamp with time zone default timezone('utc'::text, now()) not null,
  valid_until timestamp with time zone,
  revoked_at timestamp with time zone,
  show_to_user boolean default true not null,
  display_order integer default 0 not null,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists platform_accounts_platform_idx on public.platform_accounts(platform_id);
create index if not exists platform_account_assignments_profile_idx on public.platform_account_assignments(profile_id);
create index if not exists platform_account_assignments_account_idx on public.platform_account_assignments(account_id);

alter table public.platform_accounts enable row level security;
alter table public.platform_account_assignments enable row level security;

-- MIGRATION: move existing single-login secrets from platforms into a default account per platform
insert into public.platform_accounts (platform_id, label, access_email, access_password, extension_link, status)
select p.id, 'Padrão', p.access_email, p.access_password, p.extension_link, 'active'
from public.platforms p
where (p.access_email is not null or p.access_password is not null)
  and not exists (
    select 1 from public.platform_accounts a
    where a.platform_id = p.id and a.label = 'Padrão'
  );

-- VIEW: list platforms without secrets for authenticated users
-- (created by the SQL editor owner; owner bypasses RLS unless FORCE RLS is enabled)
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

drop policy if exists "Authenticated users can CRUD platforms (Demo Mode)" on public.platforms;
drop policy if exists "Platforms are viewable by authenticated users" on public.platforms;
drop policy if exists "Admins can insert platforms" on public.platforms;
drop policy if exists "Admins can update platforms" on public.platforms;
drop policy if exists "Admins can delete platforms" on public.platforms;

drop policy if exists "Admins can view all platforms" on public.platforms;
drop policy if exists "Users with access can view platform secrets" on public.platforms;

drop policy if exists "Platforms are viewable by authenticated users" on public.platforms;

create policy "Admins can view all platforms"
  on public.platforms for select
  to authenticated
  using ( public.is_admin(auth.uid()) );

-- Allow authenticated users to list platforms (safe fields). Legacy secret columns are protected via column privileges below.
create policy "Platforms are viewable by authenticated users"
  on public.platforms for select
  to authenticated
  using ( true );

-- Students should not read secrets directly from platforms; listing is done via platforms_public.

-- Column-level protection for legacy secrets (clients should use platform_accounts instead)
revoke select (access_email, access_password) on table public.platforms from anon;
revoke select (access_email, access_password) on table public.platforms from authenticated;
grant select (access_email, access_password) on table public.platforms to service_role;

-- PLATFORMS RLS: only admins can write
create policy "Admins can insert platforms"
  on public.platforms for insert
  to authenticated
  with check ( public.is_admin(auth.uid()) );

create policy "Admins can update platforms"
  on public.platforms for update
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

create policy "Admins can delete platforms"
  on public.platforms for delete
  to authenticated
  using ( public.is_admin(auth.uid()) );

-- PLATFORM_ACCOUNTS RLS
drop policy if exists "Admins can manage platform accounts" on public.platform_accounts;
drop policy if exists "Users can view assigned platform accounts" on public.platform_accounts;

create policy "Admins can manage platform accounts"
  on public.platform_accounts for all
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

create policy "Users can view assigned platform accounts"
  on public.platform_accounts for select
  to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      public.platform_accounts.status = 'active'
      and exists (
      select 1
      from public.platform_account_assignments paa
      where paa.account_id = public.platform_accounts.id
        and paa.profile_id = auth.uid()
        and paa.revoked_at is null
        and paa.show_to_user = true
        and paa.valid_from <= now()
        and (paa.valid_until is null or paa.valid_until > now())
      )
    )
  );

-- PLATFORM_ACCOUNT_ASSIGNMENTS RLS
drop policy if exists "Admins can manage platform assignments" on public.platform_account_assignments;
drop policy if exists "Users can view own platform assignments" on public.platform_account_assignments;

create policy "Admins can manage platform assignments"
  on public.platform_account_assignments for all
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

create policy "Users can view own platform assignments"
  on public.platform_account_assignments for select
  to authenticated
  using ( auth.uid() = profile_id );

-- USER_PLATFORM_ACCESS RLS
drop policy if exists "Users can view own platform access" on public.user_platform_access;
drop policy if exists "Admins can view all platform access" on public.user_platform_access;
drop policy if exists "Admins can manage platform access" on public.user_platform_access;

create policy "Users can view own platform access"
  on public.user_platform_access for select
  to authenticated
  using ( auth.uid() = profile_id );

create policy "Admins can view all platform access"
  on public.user_platform_access for select
  to authenticated
  using ( public.is_admin(auth.uid()) );

create policy "Admins can manage platform access"
  on public.user_platform_access for all
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

-- If you just created/changed tables, force PostgREST to reload schema cache.
notify pgrst, 'reload schema';

-- Setup some initial data
insert into public.platforms (name, description, image_url, status, access_email, access_password)
select * from (
  values
  ('Estratégia Concursos', 'O que mais aprova em concursos.', 'https://placehold.co/100x100?text=EC', 'active', null, null),
  ('Gran Cursos', 'Aulas ilimitadas para todos.', 'https://placehold.co/100x100?text=GC', 'active', null, null)
) as v(name, description, image_url, status, access_email, access_password)
where not exists (
  select 1 from public.platforms p where p.name = v.name
);
