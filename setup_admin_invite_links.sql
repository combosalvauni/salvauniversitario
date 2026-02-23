-- Convites administrativos para liberar acesso da loja automaticamente
-- Execute após `setup_wallet_store_checkout.sql` e `setup_checkout_auto_access.sql`

create extension if not exists "uuid-ossp";

create table if not exists public.admin_invite_links (
  id uuid primary key default uuid_generate_v4(),
  token_hash text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  target_email text,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  grant_store_access boolean not null default true,
  grant_credits integer not null default 0 check (grant_credits >= 0),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamp with time zone not null,
  last_used_at timestamp with time zone,
  last_used_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists admin_invite_links_status_expires_idx
  on public.admin_invite_links(status, expires_at asc);

create index if not exists admin_invite_links_target_email_idx
  on public.admin_invite_links(lower(target_email));

create index if not exists admin_invite_links_created_at_idx
  on public.admin_invite_links(created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists touch_admin_invite_links_updated_at on public.admin_invite_links;
create trigger touch_admin_invite_links_updated_at
before update on public.admin_invite_links
for each row execute procedure public.touch_updated_at();

alter table public.admin_invite_links enable row level security;

drop policy if exists "Admins can view invite links" on public.admin_invite_links;
create policy "Admins can view invite links"
  on public.admin_invite_links for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins can manage invite links" on public.admin_invite_links;
create policy "Admins can manage invite links"
  on public.admin_invite_links for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create or replace function public.claim_admin_invite_link(
  p_token_hash text,
  p_profile_id uuid,
  p_profile_email text default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(trim(coalesce(p_token_hash, '')), '');
  v_profile_email text := lower(trim(coalesce(p_profile_email, '')));
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_invite public.admin_invite_links%rowtype;
  v_credit_to_grant integer := 0;
begin
  if p_profile_id is null then
    return jsonb_build_object('status', 'invalid_profile');
  end if;

  if v_token_hash is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  if v_profile_email = '' then
    select lower(coalesce(pr.email, ''))
    into v_profile_email
    from public.profiles pr
    where pr.id = p_profile_id;
  end if;

  select *
  into v_invite
  from public.admin_invite_links
  where token_hash = v_token_hash
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  if v_invite.status = 'revoked' then
    return jsonb_build_object('status', 'revoked');
  end if;

  if v_invite.expires_at <= v_now then
    update public.admin_invite_links
      set status = 'expired'
    where id = v_invite.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if coalesce(v_invite.used_count, 0) >= coalesce(v_invite.max_uses, 1) then
    update public.admin_invite_links
      set status = 'expired'
    where id = v_invite.id;
    return jsonb_build_object('status', 'already_used');
  end if;

  if coalesce(trim(v_invite.target_email), '') <> ''
     and lower(trim(v_invite.target_email)) <> v_profile_email then
    return jsonb_build_object('status', 'email_mismatch');
  end if;

  if coalesce(v_invite.grant_store_access, true) then
    update public.profiles
      set can_access_store = true
    where id = p_profile_id;
  end if;

  v_credit_to_grant := greatest(coalesce(v_invite.grant_credits, 0), 0);
  if v_credit_to_grant > 0 and to_regclass('public.wallet_balances') is not null and to_regclass('public.wallet_transactions') is not null then
    insert into public.wallet_transactions (
      profile_id,
      type,
      amount,
      source,
      reference_id,
      description,
      metadata
    ) values (
      p_profile_id,
      'credit',
      v_credit_to_grant,
      'admin_invite_link',
      v_invite.id::text,
      'Crédito por convite administrativo',
      jsonb_build_object(
        'invite_id', v_invite.id,
        'created_by', v_invite.created_by,
        'ip', p_ip
      )
    );
  end if;

  update public.admin_invite_links
    set used_count = used_count + 1,
        last_used_at = v_now,
        last_used_by = p_profile_id,
        status = case when used_count + 1 >= max_uses then 'expired' else 'active' end
  where id = v_invite.id;

  return jsonb_build_object(
    'status', 'claimed',
    'invite_id', v_invite.id,
    'granted_store_access', coalesce(v_invite.grant_store_access, true),
    'granted_credits', v_credit_to_grant
  );
end;
$$;