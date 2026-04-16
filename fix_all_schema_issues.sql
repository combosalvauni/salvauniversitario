-- ============================================================
-- FIX ALL SCHEMA ISSUES - Idempotente (seguro rodar N vezes)
-- Execute no Supabase SQL Editor
-- Gerado em: 2026-02-26
-- ============================================================

-- ============================================================
-- PARTE 1: UNIQUE CONSTRAINTS CRÍTICAS (idempotência)
-- ============================================================

-- 1a) checkout_webhook_events: UNIQUE(provider_name, provider_event_id)
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
    -- Limpa duplicatas antes de criar a constraint
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

    raise notice '[FIX] ADDED: checkout_webhook_events UNIQUE(provider_name, provider_event_id)';
  else
    raise notice '[OK] checkout_webhook_events UNIQUE constraint already exists';
  end if;
end $$;

-- 1b) checkout_pending_benefits: UNIQUE(provider_name, provider_event_id)
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

    raise notice '[FIX] ADDED: checkout_pending_benefits UNIQUE(provider_name, provider_event_id)';
  else
    raise notice '[OK] checkout_pending_benefits UNIQUE constraint already exists';
  end if;
end $$;

-- ============================================================
-- PARTE 2: FK ON DELETE CASCADE (integridade referencial)
-- ============================================================

-- checkout_orders.profile_id → ON DELETE CASCADE
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'checkout_orders_profile_id_fkey'
      and conrelid = 'public.checkout_orders'::regclass
  ) then
    alter table public.checkout_orders drop constraint checkout_orders_profile_id_fkey;
  end if;
  alter table public.checkout_orders
    add constraint checkout_orders_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete cascade;
  raise notice '[FIX] checkout_orders.profile_id → ON DELETE CASCADE';
end $$;

-- wallet_balances.profile_id → ON DELETE CASCADE
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'wallet_balances_profile_id_fkey'
      and conrelid = 'public.wallet_balances'::regclass
  ) then
    alter table public.wallet_balances drop constraint wallet_balances_profile_id_fkey;
  end if;
  -- wallet_balances usa profile_id como PK, precisa tratar diferente
  -- a FK pode estar implícita na PK. Vamos verificar se a FK existe separada
  if not exists (
    select 1 from pg_constraint
    where conname = 'wallet_balances_profile_id_fkey'
      and conrelid = 'public.wallet_balances'::regclass
  ) then
    alter table public.wallet_balances
      add constraint wallet_balances_profile_id_fkey
      foreign key (profile_id) references public.profiles(id) on delete cascade;
  end if;
  raise notice '[FIX] wallet_balances.profile_id → ON DELETE CASCADE';
end $$;

-- wallet_transactions.profile_id → ON DELETE CASCADE
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'wallet_transactions_profile_id_fkey'
      and conrelid = 'public.wallet_transactions'::regclass
  ) then
    alter table public.wallet_transactions drop constraint wallet_transactions_profile_id_fkey;
  end if;
  alter table public.wallet_transactions
    add constraint wallet_transactions_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete cascade;
  raise notice '[FIX] wallet_transactions.profile_id → ON DELETE CASCADE';
end $$;

-- store_cart_items.profile_id → ON DELETE CASCADE
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'store_cart_items_profile_id_fkey'
      and conrelid = 'public.store_cart_items'::regclass
  ) then
    alter table public.store_cart_items drop constraint store_cart_items_profile_id_fkey;
  end if;
  alter table public.store_cart_items
    add constraint store_cart_items_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete cascade;
  raise notice '[FIX] store_cart_items.profile_id → ON DELETE CASCADE';
end $$;

-- store_cart_items.product_id → ON DELETE CASCADE
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'store_cart_items_product_id_fkey'
      and conrelid = 'public.store_cart_items'::regclass
  ) then
    alter table public.store_cart_items drop constraint store_cart_items_product_id_fkey;
  end if;
  alter table public.store_cart_items
    add constraint store_cart_items_product_id_fkey
    foreign key (product_id) references public.store_products(id) on delete cascade;
  raise notice '[FIX] store_cart_items.product_id → ON DELETE CASCADE';
end $$;

-- ============================================================
-- PARTE 3: RLS ENABLE em todas as tabelas sensíveis
-- ============================================================

alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.store_products enable row level security;
alter table public.store_cart_items enable row level security;
alter table public.checkout_orders enable row level security;
alter table public.checkout_webhook_events enable row level security;
alter table public.checkout_pending_benefits enable row level security;
alter table public.wallet_topup_plans enable row level security;

-- ============================================================
-- PARTE 4: RLS POLICIES
-- ============================================================

-- wallet_balances
drop policy if exists "Users can view own wallet balance" on public.wallet_balances;
drop policy if exists "Admins can manage wallet balances" on public.wallet_balances;
create policy "Users can view own wallet balance"
  on public.wallet_balances for select
  to authenticated
  using (auth.uid() = profile_id);
create policy "Admins can manage wallet balances"
  on public.wallet_balances for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- wallet_transactions
drop policy if exists "Users can view own wallet transactions" on public.wallet_transactions;
drop policy if exists "Admins can manage wallet transactions" on public.wallet_transactions;
create policy "Users can view own wallet transactions"
  on public.wallet_transactions for select
  to authenticated
  using (auth.uid() = profile_id);
create policy "Admins can manage wallet transactions"
  on public.wallet_transactions for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- store_products
drop policy if exists "Authenticated users can view visible store products" on public.store_products;
drop policy if exists "Admins can manage store products" on public.store_products;
create policy "Authenticated users can view visible store products"
  on public.store_products for select
  to authenticated
  using (is_active = true and is_visible = true);
create policy "Admins can manage store products"
  on public.store_products for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- store_cart_items
drop policy if exists "Users can manage own cart" on public.store_cart_items;
drop policy if exists "Admins can manage all carts" on public.store_cart_items;
create policy "Users can manage own cart"
  on public.store_cart_items for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
create policy "Admins can manage all carts"
  on public.store_cart_items for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- checkout_orders
drop policy if exists "Users can view own orders" on public.checkout_orders;
drop policy if exists "Users can create own draft orders" on public.checkout_orders;
drop policy if exists "Admins can manage all orders" on public.checkout_orders;
create policy "Users can view own orders"
  on public.checkout_orders for select
  to authenticated
  using (auth.uid() = profile_id);
create policy "Users can create own draft orders"
  on public.checkout_orders for insert
  to authenticated
  with check (auth.uid() = profile_id);
create policy "Admins can manage all orders"
  on public.checkout_orders for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- checkout_webhook_events
drop policy if exists "Admins can view webhook events" on public.checkout_webhook_events;
create policy "Admins can view webhook events"
  on public.checkout_webhook_events for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- checkout_pending_benefits
drop policy if exists "Admins can view pending checkout benefits" on public.checkout_pending_benefits;
create policy "Admins can view pending checkout benefits"
  on public.checkout_pending_benefits for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- wallet_topup_plans
drop policy if exists "Authenticated users can view visible topup plans" on public.wallet_topup_plans;
drop policy if exists "Admins can manage topup plans" on public.wallet_topup_plans;
create policy "Authenticated users can view visible topup plans"
  on public.wallet_topup_plans for select
  to authenticated
  using (is_active = true and is_visible = true);
create policy "Admins can manage topup plans"
  on public.wallet_topup_plans for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================
-- PARTE 5: INDEXES (performance + idempotência de transações)
-- ============================================================

create unique index if not exists wallet_tx_unique_source_ref_idx
  on public.wallet_transactions(profile_id, source, reference_id)
  where reference_id is not null;

create index if not exists wallet_tx_profile_created_idx
  on public.wallet_transactions(profile_id, created_at desc);

create index if not exists checkout_orders_profile_created_idx
  on public.checkout_orders(profile_id, created_at desc);

create index if not exists checkout_webhook_order_idx
  on public.checkout_webhook_events(provider_order_id);

create index if not exists checkout_pending_benefits_status_idx
  on public.checkout_pending_benefits(status, created_at desc);

create index if not exists checkout_pending_benefits_email_idx
  on public.checkout_pending_benefits(lower(payer_email));

create index if not exists checkout_pending_benefits_profile_idx
  on public.checkout_pending_benefits(profile_id);

create index if not exists store_products_sort_order_idx
  on public.store_products(sort_order);

create index if not exists store_cart_items_profile_idx
  on public.store_cart_items(profile_id);

create index if not exists wallet_topup_plans_sort_order_idx
  on public.wallet_topup_plans(sort_order);

-- ============================================================
-- PARTE 6: TRIGGERS (updated_at automático)
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists touch_store_products_updated_at on public.store_products;
create trigger touch_store_products_updated_at
before update on public.store_products
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_store_cart_items_updated_at on public.store_cart_items;
create trigger touch_store_cart_items_updated_at
before update on public.store_cart_items
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_checkout_orders_updated_at on public.checkout_orders;
create trigger touch_checkout_orders_updated_at
before update on public.checkout_orders
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_checkout_pending_benefits_updated_at on public.checkout_pending_benefits;
create trigger touch_checkout_pending_benefits_updated_at
before update on public.checkout_pending_benefits
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_wallet_topup_plans_updated_at on public.wallet_topup_plans;
create trigger touch_wallet_topup_plans_updated_at
before update on public.wallet_topup_plans
for each row execute procedure public.touch_updated_at();

-- ============================================================
-- PARTE 7: FUNÇÃO - apply_checkout_paid_and_grant_access
-- (confirmação de pagamento + liberação automática de acesso)
-- ============================================================

create or replace function public.apply_checkout_paid_and_grant_access(
  p_provider_name text,
  p_provider_event_id text,
  p_provider_order_id text,
  p_checkout_order_id uuid default null,
  p_event_type text default 'payment.approved',
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.checkout_orders%rowtype;
  v_inserted_event uuid;
  v_items jsonb;
  v_item jsonb;
  v_platform_id uuid;
  v_product_id uuid;
  v_quantity integer;
  v_selected_cycle text;
  v_months integer;
  v_extension interval;
  v_valid_until timestamp with time zone;
  v_account_id uuid;
  v_existing_assignment_id uuid;
  v_existing_assignment_valid_until timestamp with time zone;
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_assigned_count integer := 0;
  v_i integer;
begin
  insert into public.checkout_webhook_events (
    provider_name,
    provider_event_id,
    provider_order_id,
    event_type,
    payload,
    processed_at
  ) values (
    coalesce(nullif(trim(p_provider_name), ''), 'banco_babylon'),
    coalesce(nullif(trim(p_provider_event_id), ''), md5(coalesce(p_payload::text, '{}'))),
    nullif(trim(p_provider_order_id), ''),
    coalesce(nullif(trim(p_event_type), ''), 'payment.approved'),
    coalesce(p_payload, '{}'::jsonb),
    v_now
  )
  on conflict (provider_name, provider_event_id) do nothing
  returning id into v_inserted_event;

  if v_inserted_event is null then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  if p_checkout_order_id is not null then
    select *
      into v_order
    from public.checkout_orders
    where id = p_checkout_order_id
    for update;
  elsif coalesce(trim(p_provider_order_id), '') <> '' then
    select *
      into v_order
    from public.checkout_orders
    where provider_order_id = p_provider_order_id
    for update;
  end if;

  if v_order.id is null then
    return jsonb_build_object('status', 'order_not_found');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('status', 'already_paid', 'order_id', v_order.id);
  end if;

  if coalesce(lower(trim(p_event_type)), '') not in ('payment.approved', 'order.paid', 'paid', 'approved') then
    update public.checkout_orders
      set status = case
        when lower(trim(coalesce(p_event_type, ''))) in ('payment.failed', 'failed') then 'failed'
        when lower(trim(coalesce(p_event_type, ''))) in ('canceled', 'cancelled') then 'canceled'
        else status
      end,
      metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
        'last_webhook_event', jsonb_build_object(
          'provider', coalesce(nullif(trim(p_provider_name), ''), 'banco_babylon'),
          'event_id', p_provider_event_id,
          'event_type', p_event_type,
          'received_at', v_now
        )
      )
    where id = v_order.id;

    return jsonb_build_object('status', 'ignored_event_type', 'order_id', v_order.id);
  end if;

  v_items := coalesce(v_order.metadata->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) is distinct from 'array' then
    update public.checkout_orders
      set status = 'failed',
          metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
            'access_grant', jsonb_build_object(
              'status', 'invalid_items_payload',
              'validated_at', v_now
            )
          )
    where id = v_order.id;

    return jsonb_build_object('status', 'failed_invalid_items', 'order_id', v_order.id);
  end if;

  for v_item in
    select value from jsonb_array_elements(v_items)
  loop
    v_platform_id := nullif(trim(coalesce(v_item->>'platform_id', '')), '')::uuid;
    v_product_id := nullif(trim(coalesce(v_item->>'product_id', '')), '')::uuid;
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
    v_selected_cycle := lower(trim(coalesce(v_item->>'selected_cycle', 'mensal')));
    if v_selected_cycle = '' then v_selected_cycle := 'mensal'; end if;

    if v_platform_id is null and v_product_id is not null then
      select nullif(sp.metadata->>'platform_id', '')::uuid
      into v_platform_id
      from public.store_products sp
      where sp.id = v_product_id
      limit 1;
    end if;

    if v_platform_id is null then
      update public.checkout_orders
        set status = 'failed',
            metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
              'access_grant', jsonb_build_object(
                'status', 'platform_not_mapped',
                'item', v_item,
                'validated_at', v_now
              )
            )
      where id = v_order.id;

      return jsonb_build_object('status', 'failed_platform_not_mapped', 'order_id', v_order.id);
    end if;

    v_months := case
      when v_selected_cycle = 'mensal' then 1
      when v_selected_cycle = 'trimestral' then 3
      when v_selected_cycle = 'semestral' then 6
      when v_selected_cycle = 'anual' then 12
      else 1
    end;

    v_extension := make_interval(months => greatest(v_months * v_quantity, 1));

    select ass.id, ass.valid_until
      into v_existing_assignment_id, v_existing_assignment_valid_until
    from public.platform_account_assignments ass
    join public.platform_accounts pa on pa.id = ass.account_id
    where ass.profile_id = v_order.profile_id
      and pa.platform_id = v_platform_id
      and pa.status = 'active'
      and ass.revoked_at is null
      and ass.show_to_user = true
    order by
      case when ass.valid_until is null then 1 else 0 end desc,
      ass.valid_until desc,
      ass.created_at desc
    limit 1
    for update skip locked;

    if v_existing_assignment_id is not null then
      update public.platform_account_assignments
        set valid_until = case
          when v_existing_assignment_valid_until is null then null
          when v_existing_assignment_valid_until > v_now then v_existing_assignment_valid_until + v_extension
          else v_now + v_extension
        end,
        note = case
          when coalesce(trim(note), '') = '' then format('Renovado via checkout %s', v_order.id)
          else note || format(' | Renovado via checkout %s', v_order.id)
        end
      where id = v_existing_assignment_id;

      v_assigned_count := v_assigned_count + 1;
      continue;
    end if;

    v_valid_until := v_now + make_interval(months => v_months);

    for v_i in 1..v_quantity loop
      select pa.id
        into v_account_id
      from public.platform_accounts pa
      where pa.platform_id = v_platform_id
        and pa.status = 'active'
        and (
          pa.max_seats is null
          or pa.max_seats <= 0
          or (
            select count(*)
            from public.platform_account_assignments ass
            where ass.account_id = pa.id
              and ass.revoked_at is null
              and ass.valid_from <= v_now
              and (ass.valid_until is null or ass.valid_until > v_now)
          ) < pa.max_seats
        )
      order by
        (
          select count(*)
          from public.platform_account_assignments ass
          where ass.account_id = pa.id
            and ass.revoked_at is null
            and ass.valid_from <= v_now
            and (ass.valid_until is null or ass.valid_until > v_now)
        ) asc,
        pa.created_at asc
      limit 1
      for update skip locked;

      if v_account_id is null then
        update public.checkout_orders
          set status = 'failed',
              metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
                'access_grant', jsonb_build_object(
                  'status', 'no_available_accounts',
                  'platform_id', v_platform_id,
                  'validated_at', v_now
                )
              )
        where id = v_order.id;

        return jsonb_build_object('status', 'failed_no_available_accounts', 'order_id', v_order.id, 'platform_id', v_platform_id);
      end if;

      insert into public.platform_account_assignments (
        account_id,
        profile_id,
        valid_from,
        valid_until,
        show_to_user,
        display_order,
        note
      ) values (
        v_account_id,
        v_order.profile_id,
        v_now,
        v_valid_until,
        true,
        0,
        format('Acesso automático via checkout %s', v_order.id)
      );

      v_assigned_count := v_assigned_count + 1;
    end loop;
  end loop;

  update public.checkout_orders
    set status = 'paid',
        paid_at = v_now,
        provider_name = coalesce(nullif(trim(p_provider_name), ''), provider_name),
        provider_order_id = coalesce(nullif(trim(p_provider_order_id), ''), provider_order_id),
        metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
          'access_grant', jsonb_build_object(
            'status', 'granted',
            'assigned_count', v_assigned_count,
            'granted_at', v_now,
            'event_id', p_provider_event_id
          ),
          'payment_provider', coalesce(nullif(trim(p_provider_name), ''), 'banco_babylon')
        )
  where id = v_order.id;

  return jsonb_build_object(
    'status', 'paid_and_access_granted',
    'order_id', v_order.id,
    'assigned_count', v_assigned_count
  );
end;
$$;

revoke all on function public.apply_checkout_paid_and_grant_access(text, text, text, uuid, text, jsonb) from public;
grant execute on function public.apply_checkout_paid_and_grant_access(text, text, text, uuid, text, jsonb) to service_role;

-- ============================================================
-- PARTE 8: FUNÇÃO - register_pending_checkout_benefit
-- (registra benefício pendente para e-mail antes de ter conta)
-- ============================================================

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

-- ============================================================
-- PARTE 9: FUNÇÃO - apply_pending_checkout_benefits_for_profile
-- (aplica benefícios pendentes quando o user faz login/signup)
-- ============================================================

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

-- ============================================================
-- PARTE 10: PERMISSÕES DAS FUNÇÕES
-- ============================================================

revoke all on function public.register_pending_checkout_benefit(text, text, text, text, text, text, integer, integer, boolean, jsonb) from public;
revoke all on function public.apply_pending_checkout_benefits_for_profile(uuid, text) from public;

grant execute on function public.register_pending_checkout_benefit(text, text, text, text, text, text, integer, integer, boolean, jsonb) to service_role;
grant execute on function public.apply_pending_checkout_benefits_for_profile(uuid, text) to service_role;

-- Authenticated users precisam chamar claim-pending-benefits via RPC
grant execute on function public.apply_pending_checkout_benefits_for_profile(uuid, text) to authenticated;

-- ============================================================
-- PARTE 11: RELOAD SCHEMA DO POSTGREST
-- ============================================================

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICAÇÃO FINAL (rode após o script para confirmar)
-- ============================================================
-- Descomente e rode separadamente para verificar:
--
-- SELECT 'UNIQUE constraints' as check_type, conname, conrelid::regclass
-- FROM pg_constraint
-- WHERE contype = 'u'
--   AND conrelid::regclass::text IN ('checkout_webhook_events', 'checkout_pending_benefits');
--
-- SELECT 'RLS status' as check_type, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('wallet_balances', 'wallet_transactions', 'store_products',
--     'store_cart_items', 'checkout_orders', 'checkout_webhook_events',
--     'checkout_pending_benefits', 'wallet_topup_plans');
--
-- SELECT 'Functions' as check_type, proname, prosecdef as is_security_definer
-- FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
--   AND proname IN ('apply_checkout_paid_and_grant_access',
--     'register_pending_checkout_benefit',
--     'apply_pending_checkout_benefits_for_profile',
--     'touch_updated_at');
--
-- SELECT 'FK cascade' as check_type, conname, confdeltype
-- FROM pg_constraint
-- WHERE contype = 'f'
--   AND conrelid::regclass::text IN ('checkout_orders', 'wallet_balances',
--     'wallet_transactions', 'store_cart_items')
--   AND conname LIKE '%profile_id%' OR conname LIKE '%product_id%';
