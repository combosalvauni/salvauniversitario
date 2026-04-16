-- 1. Set the specific user as ADMIN
-- Prefer running as SQL Editor (postgres) or via service_role.
-- This uses a helper that is NOT executable by normal clients.
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
    raise notice '[SKIP] User % not found in auth.users. Create the auth user first and rerun this script.', v_admin_email;
  end if;
end $$;

-- Platform ordering (ensure before view uses sort_order)
alter table public.platforms add column if not exists sort_order integer;
update public.platforms set sort_order = 0 where sort_order is null;
alter table public.platforms alter column sort_order set default 0;
alter table public.platforms alter column sort_order set not null;
create index if not exists platforms_sort_order_idx on public.platforms(sort_order);

-- 2. Platform access model (per-user) + safe listing

create table if not exists public.user_platform_access (
  profile_id uuid references public.profiles(id) on delete cascade not null,
  platform_id uuid references public.platforms(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (profile_id, platform_id)
);

-- MIGRATION: allow multiple access grants per (user, platform) with custom dates
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

alter table public.user_platform_access drop constraint if exists user_platform_access_pkey;
alter table public.user_platform_access add constraint user_platform_access_pkey primary key (id);

create index if not exists user_platform_access_profile_platform_idx
  on public.user_platform_access(profile_id, platform_id);

alter table public.user_platform_access enable row level security;

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

-- View without secrets for cards/listing
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

-- 3. Strict RLS on platforms (secrets only when permitted)
drop policy if exists "Authenticated users can CRUD platforms (Demo Mode)" on public.platforms;
drop policy if exists "Platforms are viewable by authenticated users" on public.platforms;
drop policy if exists "Admins can insert platforms" on public.platforms;
drop policy if exists "Admins can update platforms" on public.platforms;
drop policy if exists "Admins can delete platforms" on public.platforms;
drop policy if exists "Admins can view all platforms" on public.platforms;
drop policy if exists "Users with access can view platform secrets" on public.platforms;

create policy "Admins can view all platforms"
  on public.platforms for select
  to authenticated
  using ( public.is_admin(auth.uid()) );

create policy "Platforms are viewable by authenticated users"
  on public.platforms for select
  to authenticated
  using ( true );

revoke select (access_email, access_password) on table public.platforms from anon;
revoke select (access_email, access_password) on table public.platforms from authenticated;
grant select (access_email, access_password) on table public.platforms to service_role;

-- Policy: Only ADMINS can INSERT
create policy "Admins can insert platforms"
  on public.platforms for insert
  to authenticated
  with check ( public.is_admin(auth.uid()) );

-- Policy: Only ADMINS can UPDATE
create policy "Admins can update platforms"
  on public.platforms for update
  to authenticated
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

-- Policy: Only ADMINS can DELETE
create policy "Admins can delete platforms"
  on public.platforms for delete
  to authenticated
  using ( public.is_admin(auth.uid()) );

notify pgrst, 'reload schema';

-- 4. Multiple accounts per platform + assignments (new model)

create table if not exists public.platform_accounts (
  id uuid default uuid_generate_v4() primary key,
  platform_id uuid references public.platforms(id) on delete cascade not null,
  label text not null default 'Padrão',
  access_email text,
  access_password text,
  extension_link text,
  status text default 'active',
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

-- MIGRATION: create a default account per platform from existing platforms secrets
insert into public.platform_accounts (platform_id, label, access_email, access_password, extension_link, status)
select p.id, 'Padrão', p.access_email, p.access_password, p.extension_link, 'active'
from public.platforms p
where (p.access_email is not null or p.access_password is not null)
  and not exists (
    select 1 from public.platform_accounts a
    where a.platform_id = p.id and a.label = 'Padrão'
  );

-- Lock down secrets in platforms (students should use platforms_public + accounts)
drop policy if exists "Users with access can view platform secrets" on public.platforms;

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

notify pgrst, 'reload schema';
