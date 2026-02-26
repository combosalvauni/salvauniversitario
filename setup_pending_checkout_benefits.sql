-- Pending checkout benefits + idempotency hardening
-- Execute após `setup_wallet_store_checkout.sql` e `setup_checkout_auto_access.sql`

create extension if not exists "uuid-ossp";

create table if not exists public.checkout_pending_benefits (
  id uuid primary key default uuid_generate_v4(),
  provider_name text not null default 'banco_babylon',
  provider_event_id text not null,
  provider_order_id text,
  checkout_order_id text,
  payer_email text not null,
  payer_phone text,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  credit_amount integer not null default 0 check (credit_amount >= 0),
  activate_store boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'applied', 'ignored')),
  profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  applied_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists checkout_pending_benefits_status_idx
  on public.checkout_pending_benefits(status, created_at desc);

create index if not exists checkout_pending_benefits_email_idx
  on public.checkout_pending_benefits(lower(payer_email));

create index if not exists checkout_pending_benefits_profile_idx
  on public.checkout_pending_benefits(profile_id);

-- Idempotência de eventos: backend usa ON CONFLICT (provider_name, provider_event_id)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'checkout_webhook_events'
      and c.contype = 'u'
      and c.conname = 'checkout_webhook_events_provider_name_provider_event_id_key'
  ) then
    with ranked as (
      select id,
             row_number() over (
               partition by provider_name, provider_event_id
               order by received_at asc, id asc
             ) as rn
      from public.checkout_webhook_events
      where provider_name is not null
        and provider_event_id is not null
    )
    delete from public.checkout_webhook_events e
    using ranked r
    where e.id = r.id
      and r.rn > 1;

    alter table public.checkout_webhook_events
      add constraint checkout_webhook_events_provider_name_provider_event_id_key
      unique (provider_name, provider_event_id);
  end if;
end $$;

-- Idempotência também para benefícios pendentes
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'checkout_pending_benefits'
      and c.contype = 'u'
      and c.conname = 'checkout_pending_benefits_provider_name_provider_event_id_key'
  ) then
    with ranked as (
      select id,
             row_number() over (
               partition by provider_name, provider_event_id
               order by created_at asc, id asc
             ) as rn
      from public.checkout_pending_benefits
      where provider_name is not null
        and provider_event_id is not null
    )
    delete from public.checkout_pending_benefits p
    using ranked r
    where p.id = r.id
      and r.rn > 1;

    alter table public.checkout_pending_benefits
      add constraint checkout_pending_benefits_provider_name_provider_event_id_key
      unique (provider_name, provider_event_id);
  end if;
end $$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists touch_checkout_pending_benefits_updated_at on public.checkout_pending_benefits;
create trigger touch_checkout_pending_benefits_updated_at
before update on public.checkout_pending_benefits
for each row execute procedure public.touch_updated_at();

alter table public.checkout_pending_benefits enable row level security;

drop policy if exists "Admins can view pending checkout benefits" on public.checkout_pending_benefits;
create policy "Admins can view pending checkout benefits"
  on public.checkout_pending_benefits for select
  to authenticated
  using (public.is_admin(auth.uid()));

create or replace function public.register_pending_checkout_benefit(
  p_provider_name text,
  p_provider_event_id text,
  p_provider_order_id text default null,
  p_checkout_order_id text default null,
  p_payer_email text default null,
  p_payer_phone text default null,
  p_amount_cents integer default 0,
  p_credit_amount integer default 0,
  p_activate_store boolean default true,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_name text := coalesce(nullif(trim(p_provider_name), ''), 'banco_babylon');
  v_provider_event_id text := nullif(trim(p_provider_event_id), '');
  v_email text := lower(trim(coalesce(p_payer_email, '')));
  v_phone_digits text := regexp_replace(coalesce(p_payer_phone, ''), '\\D', '', 'g');
  v_credit integer := greatest(coalesce(p_credit_amount, 0), 0);
  v_amount integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_inserted_id uuid;
  v_profile_id uuid;
begin
  if v_provider_event_id is null then
    return jsonb_build_object('status', 'invalid_event_id');
  end if;

  if v_email = '' then
    return jsonb_build_object('status', 'invalid_email');
  end if;

  if v_credit = 0 and v_amount > 0 then
    v_credit := floor(v_amount::numeric / 100)::integer;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where lower(coalesce(p.email, '')) = v_email
  limit 1;

  insert into public.checkout_pending_benefits (
    provider_name,
    provider_event_id,
    provider_order_id,
    checkout_order_id,
    payer_email,
    payer_phone,
    amount_cents,
    credit_amount,
    activate_store,
    status,
    profile_id,
    metadata
  ) values (
    v_provider_name,
    v_provider_event_id,
    nullif(trim(coalesce(p_provider_order_id, '')), ''),
    nullif(trim(coalesce(p_checkout_order_id, '')), ''),
    v_email,
    nullif(v_phone_digits, ''),
    v_amount,
    v_credit,
    coalesce(p_activate_store, true),
    'pending',
    v_profile_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider_name, provider_event_id) do update
    set provider_order_id = coalesce(excluded.provider_order_id, public.checkout_pending_benefits.provider_order_id),
        checkout_order_id = coalesce(excluded.checkout_order_id, public.checkout_pending_benefits.checkout_order_id),
        payer_email = coalesce(nullif(excluded.payer_email, ''), public.checkout_pending_benefits.payer_email),
        payer_phone = coalesce(excluded.payer_phone, public.checkout_pending_benefits.payer_phone),
        amount_cents = greatest(excluded.amount_cents, public.checkout_pending_benefits.amount_cents),
        credit_amount = greatest(excluded.credit_amount, public.checkout_pending_benefits.credit_amount),
        activate_store = excluded.activate_store,
        metadata = coalesce(public.checkout_pending_benefits.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb),
        profile_id = coalesce(public.checkout_pending_benefits.profile_id, excluded.profile_id)
  returning id into v_inserted_id;

  return jsonb_build_object(
    'status', 'pending_registered',
    'benefit_id', v_inserted_id,
    'profile_id', v_profile_id
  );
end;
$$;

create or replace function public.apply_pending_checkout_benefits_for_profile(
  p_profile_id uuid,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_applied_count integer := 0;
  v_total_credit integer := 0;
  v_store_enabled boolean := false;
  v_row public.checkout_pending_benefits%rowtype;
begin
  if p_profile_id is null then
    return jsonb_build_object('status', 'invalid_profile');
  end if;

  select lower(coalesce(pr.email, ''))
  into v_email
  from public.profiles pr
  where pr.id = p_profile_id;

  if coalesce(trim(p_email), '') <> '' then
    v_email := lower(trim(p_email));
  end if;

  for v_row in
    select *
    from public.checkout_pending_benefits
    where status = 'pending'
      and (
        profile_id = p_profile_id
        or (v_email <> '' and lower(payer_email) = v_email)
      )
    order by created_at asc
    for update skip locked
  loop
    if coalesce(v_row.credit_amount, 0) > 0 then
      begin
        insert into public.wallet_transactions (
          profile_id,
          tx_type,
          amount,
          source,
          reference_id,
          description,
          metadata
        ) values (
          p_profile_id,
          'credit',
          v_row.credit_amount,
          'checkout_pending_benefit',
          v_row.id::text,
          'Crédito liberado por checkout pendente',
          jsonb_build_object(
            'provider_name', v_row.provider_name,
            'provider_event_id', v_row.provider_event_id,
            'provider_order_id', v_row.provider_order_id
          )
        );
      exception
        when unique_violation then
          null;
      end;

      insert into public.wallet_balances (profile_id, balance)
      values (p_profile_id, v_row.credit_amount)
      on conflict (profile_id)
      do update set
        balance = public.wallet_balances.balance + excluded.balance,
        updated_at = timezone('utc'::text, now());

      v_total_credit := v_total_credit + v_row.credit_amount;
    end if;

    if coalesce(v_row.activate_store, false) then
      update public.profiles
      set can_access_store = true
      where id = p_profile_id;
      v_store_enabled := true;
    end if;

    update public.checkout_pending_benefits
    set status = 'applied',
        profile_id = p_profile_id,
        applied_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('applied_for_profile', p_profile_id, 'applied_at', v_now)
    where id = v_row.id;

    v_applied_count := v_applied_count + 1;
  end loop;

  return jsonb_build_object(
    'status', 'applied',
    'applied_count', v_applied_count,
    'credited', v_total_credit,
    'store_enabled', v_store_enabled
  );
end;
$$;

revoke all on function public.register_pending_checkout_benefit(text, text, text, text, text, text, integer, integer, boolean, jsonb) from public;
revoke all on function public.apply_pending_checkout_benefits_for_profile(uuid, text) from public;

grant execute on function public.register_pending_checkout_benefit(text, text, text, text, text, text, integer, integer, boolean, jsonb) to service_role;
grant execute on function public.apply_pending_checkout_benefits_for_profile(uuid, text) to service_role;

grant execute on function public.apply_pending_checkout_benefits_for_profile(uuid, text) to authenticated;

notify pgrst, 'reload schema';
