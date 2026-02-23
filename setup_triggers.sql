-- Create a function that runs when a new user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, whatsapp, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'whatsapp',
    'student'
  );
  return new;
end;
$$;

-- Create the trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to make a user an admin by email (helper)
create or replace function public.make_admin(admin_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  select u.id into target_user_id
  from auth.users u
  where u.email = admin_email;

  if target_user_id is null then
    raise exception 'User with email % not found in auth.users', admin_email;
  end if;

  insert into public.profiles (id, email, full_name, whatsapp, role, subscription_status)
  values (target_user_id, admin_email, null, null, 'admin', 'anual')
  on conflict (id)
  do update set role = 'admin', subscription_status = 'anual';
end;
$$;

-- Do not allow client-side execution of make_admin()
revoke all on function public.make_admin(text) from public;
grant execute on function public.make_admin(text) to service_role;

-- Helper (idempotent): check if current user is admin
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

-- Prevent privilege escalation: block changes to role/subscription_status unless admin or service_role
create or replace function public.prevent_profile_privilege_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- If there's no request JWT context (e.g., SQL Editor / migrations), allow.
  -- Client requests always have auth.role() set ('anon' or 'authenticated').
  if auth.role() is null then
    return new;
  end if;

  -- Identity fields should follow auth.users (change via Auth, then sync server-side)
  if (new.id is distinct from old.id) then
    raise exception 'Not allowed to change id';
  end if;

  if (new.email is distinct from old.email) then
    if auth.role() <> 'service_role' then
      raise exception 'Not allowed to change email';
    end if;
  end if;

  if (new.role is distinct from old.role) then
    if auth.role() <> 'service_role' then
      raise exception 'Not allowed to change role';
    end if;
  end if;

  if (new.subscription_status is distinct from old.subscription_status) then
    if auth.role() <> 'service_role' and not public.is_admin(auth.uid()) then
      raise exception 'Not allowed to change subscription_status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profile_privilege_changes on public.profiles;
create trigger prevent_profile_privilege_changes
  before update on public.profiles
  for each row execute procedure public.prevent_profile_privilege_changes();
