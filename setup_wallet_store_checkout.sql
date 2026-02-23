-- Wallet + Store + Checkout (base schema)
-- Execute após `supabase_setup.sql`

create extension if not exists "uuid-ossp";

-- 1) SALDO (carteira interna)
create table if not exists public.wallet_balances (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  check (balance >= 0)
);

create table if not exists public.wallet_transactions (
  id uuid default uuid_generate_v4() primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tx_type text not null check (tx_type in ('credit', 'debit', 'adjustment')),
  amount integer not null check (amount > 0),
  source text not null,
  reference_id text,
  description text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists wallet_tx_unique_source_ref_idx
  on public.wallet_transactions(profile_id, source, reference_id)
  where reference_id is not null;

create index if not exists wallet_tx_profile_created_idx
  on public.wallet_transactions(profile_id, created_at desc);

-- 2) PRODUTOS DA LOJA INTERNA
create table if not exists public.store_products (
  id uuid default uuid_generate_v4() primary key,
  slug text unique not null,
  name text not null,
  description text,
  product_type text not null default 'acesso' check (product_type in ('acesso', 'combo', 'plano_personalizado')),
  credit_cost integer not null default 0 check (credit_cost >= 0),
  allow_multiple_units boolean not null default true,
  is_highlight boolean not null default false,
  is_active boolean not null default true,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists store_products_sort_order_idx
  on public.store_products(sort_order);

-- 3) CARRINHO
create table if not exists public.store_cart_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.store_products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (profile_id, product_id)
);

create index if not exists store_cart_items_profile_idx
  on public.store_cart_items(profile_id);

-- 4) PEDIDOS (pré-checkout e pagamento)
create table if not exists public.checkout_orders (
  id uuid default uuid_generate_v4() primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider_name text not null default 'checkout_proprio',
  provider_order_id text unique,
  status text not null default 'draft' check (status in ('draft', 'pending', 'paid', 'failed', 'canceled', 'refunded')),
  total_credit_cost integer not null default 0 check (total_credit_cost >= 0),
  purchased_credit integer not null default 0 check (purchased_credit >= 0),
  idempotency_key text unique,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  paid_at timestamp with time zone
);

create index if not exists checkout_orders_profile_created_idx
  on public.checkout_orders(profile_id, created_at desc);

-- 5) EVENTOS DE WEBHOOK (idempotência)
create table if not exists public.checkout_webhook_events (
  id uuid default uuid_generate_v4() primary key,
  provider_name text not null default 'checkout_proprio',
  provider_event_id text not null,
  provider_order_id text,
  event_type text not null,
  payload jsonb not null,
  received_at timestamp with time zone default timezone('utc'::text, now()) not null,
  processed_at timestamp with time zone,
  unique(provider_name, provider_event_id)
);

create index if not exists checkout_webhook_order_idx
  on public.checkout_webhook_events(provider_order_id);

-- 6) UPDATED_AT helper
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

-- 7) RLS
alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.store_products enable row level security;
alter table public.store_cart_items enable row level security;
alter table public.checkout_orders enable row level security;
alter table public.checkout_webhook_events enable row level security;

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

drop policy if exists "Admins can view webhook events" on public.checkout_webhook_events;
create policy "Admins can view webhook events"
  on public.checkout_webhook_events for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- 8) RPC idempotente para webhook de pagamento aprovado
create or replace function public.apply_checkout_paid_event(
  p_provider_name text,
  p_provider_event_id text,
  p_provider_order_id text,
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.checkout_orders%rowtype;
  v_inserted_event uuid;
  v_credit integer;
  v_items jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_selected_cycle text;
  v_cycle_months integer;
  v_unit_plan_total_cents integer;
  v_unit_monthly_cents integer;
  v_subtotal_plan_cents integer;
  v_subtotal_monthly_cents integer;
  v_product_monthly_cents integer;
  v_product_metadata jsonb;
  v_product_plan_cents integer;
  v_expected_total_plan_cents integer := 0;
  v_expected_total_monthly_cents integer := 0;
  v_sent_total_plan_cents integer := 0;
  v_sent_total_monthly_cents integer := 0;
  v_item_sent_plan_total_cents integer := 0;
  v_item_sent_monthly_equivalent_cents integer := 0;
  v_monthly_access_units integer := 0;
  v_monthly_access_regular_cents integer := 0;
  v_monthly_access_discounted_cents integer := 0;
begin
  insert into public.checkout_webhook_events (
    provider_name,
    provider_event_id,
    provider_order_id,
    event_type,
    payload,
    processed_at
  ) values (
    coalesce(p_provider_name, 'checkout_proprio'),
    p_provider_event_id,
    p_provider_order_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    timezone('utc'::text, now())
  )
  on conflict (provider_name, provider_event_id) do nothing
  returning id into v_inserted_event;

  if v_inserted_event is null then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  select *
    into v_order
  from public.checkout_orders
  where provider_order_id = p_provider_order_id
  for update;

  if v_order.id is null then
    return jsonb_build_object('status', 'order_not_found');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('status', 'already_paid', 'order_id', v_order.id);
  end if;

  if p_event_type not in ('payment.approved', 'order.paid', 'paid') then
    update public.checkout_orders
      set status = case when p_event_type in ('payment.failed', 'failed') then 'failed' else status end
    where id = v_order.id;

    return jsonb_build_object('status', 'ignored_event_type', 'order_id', v_order.id);
  end if;

  v_items := coalesce(v_order.metadata->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) is distinct from 'array' then
    update public.checkout_orders
      set status = 'failed',
          metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
            'price_validation', jsonb_build_object(
              'status', 'invalid_items_payload',
              'validated_at', timezone('utc'::text, now())
            )
          )
    where id = v_order.id;

    return jsonb_build_object('status', 'price_validation_failed', 'reason', 'invalid_items_payload', 'order_id', v_order.id);
  end if;

  for v_item in
    select value from jsonb_array_elements(v_items)
  loop
    v_product_id := nullif(trim(coalesce(v_item->>'product_id', '')), '')::uuid;
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 0), 0);
    v_selected_cycle := lower(trim(coalesce(v_item->>'selected_cycle', 'mensal')));
    if v_selected_cycle = '' then v_selected_cycle := 'mensal'; end if;

    if v_product_id is null or v_quantity <= 0 then
      update public.checkout_orders
        set status = 'failed',
            metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
              'price_validation', jsonb_build_object(
                'status', 'invalid_item',
                'item', v_item,
                'validated_at', timezone('utc'::text, now())
              )
            )
      where id = v_order.id;

      return jsonb_build_object('status', 'price_validation_failed', 'reason', 'invalid_item', 'order_id', v_order.id);
    end if;

    select
      coalesce((metadata->>'price_monthly_cents')::integer, 0),
      coalesce(metadata, '{}'::jsonb)
    into v_product_monthly_cents, v_product_metadata
    from public.store_products
    where id = v_product_id
      and is_active = true
      and is_visible = true;

    if v_product_metadata is null then
      update public.checkout_orders
        set status = 'failed',
            metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
              'price_validation', jsonb_build_object(
                'status', 'product_not_available',
                'product_id', v_product_id,
                'validated_at', timezone('utc'::text, now())
              )
            )
      where id = v_order.id;

      return jsonb_build_object('status', 'price_validation_failed', 'reason', 'product_not_available', 'order_id', v_order.id, 'product_id', v_product_id);
    end if;

    v_cycle_months := case
      when v_selected_cycle = 'mensal' then 1
      when v_selected_cycle = 'trimestral' then 3
      when v_selected_cycle = 'semestral' then 6
      when v_selected_cycle = 'anual' then 12
      else 1
    end;

    if v_selected_cycle = 'mensal' then
      v_unit_plan_total_cents := greatest(v_product_monthly_cents, 0);
    else
      select coalesce((plan->>'price_cents')::integer, 0)
      into v_product_plan_cents
      from jsonb_array_elements(coalesce(v_product_metadata->'plans', '[]'::jsonb)) as plan
      where lower(trim(coalesce(plan->>'cycle', ''))) = v_selected_cycle
      limit 1;

      if coalesce(v_product_plan_cents, 0) <= 0 then
        update public.checkout_orders
          set status = 'failed',
              metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
                'price_validation', jsonb_build_object(
                  'status', 'cycle_not_available',
                  'product_id', v_product_id,
                  'selected_cycle', v_selected_cycle,
                  'validated_at', timezone('utc'::text, now())
                )
              )
        where id = v_order.id;

        return jsonb_build_object('status', 'price_validation_failed', 'reason', 'cycle_not_available', 'order_id', v_order.id, 'product_id', v_product_id, 'selected_cycle', v_selected_cycle);
      end if;

      v_unit_plan_total_cents := v_product_plan_cents;
    end if;

    v_unit_monthly_cents := round(v_unit_plan_total_cents::numeric / greatest(v_cycle_months, 1))::integer;
    v_subtotal_plan_cents := v_unit_plan_total_cents * v_quantity;
    v_subtotal_monthly_cents := v_unit_monthly_cents * v_quantity;

    v_item_sent_plan_total_cents := coalesce((v_item->>'selected_plan_total_cents')::integer, 0);
    if v_item_sent_plan_total_cents > 0 and v_item_sent_plan_total_cents <> v_unit_plan_total_cents then
      update public.checkout_orders
        set status = 'failed',
            metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
              'price_validation', jsonb_build_object(
                'status', 'item_plan_price_mismatch',
                'product_id', v_product_id,
                'selected_cycle', v_selected_cycle,
                'sent_plan_total_cents', v_item_sent_plan_total_cents,
                'expected_plan_total_cents', v_unit_plan_total_cents,
                'validated_at', timezone('utc'::text, now())
              )
            )
      where id = v_order.id;

      return jsonb_build_object('status', 'price_validation_failed', 'reason', 'item_plan_price_mismatch', 'order_id', v_order.id, 'product_id', v_product_id);
    end if;

    v_item_sent_monthly_equivalent_cents := coalesce((v_item->>'selected_monthly_equivalent_cents')::integer, 0);
    if v_item_sent_monthly_equivalent_cents > 0 and v_item_sent_monthly_equivalent_cents <> v_unit_monthly_cents then
      update public.checkout_orders
        set status = 'failed',
            metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
              'price_validation', jsonb_build_object(
                'status', 'item_monthly_price_mismatch',
                'product_id', v_product_id,
                'selected_cycle', v_selected_cycle,
                'sent_monthly_equivalent_cents', v_item_sent_monthly_equivalent_cents,
                'expected_monthly_equivalent_cents', v_unit_monthly_cents,
                'validated_at', timezone('utc'::text, now())
              )
            )
      where id = v_order.id;

      return jsonb_build_object('status', 'price_validation_failed', 'reason', 'item_monthly_price_mismatch', 'order_id', v_order.id, 'product_id', v_product_id);
    end if;

    v_expected_total_plan_cents := v_expected_total_plan_cents + v_subtotal_plan_cents;
    v_expected_total_monthly_cents := v_expected_total_monthly_cents + v_subtotal_monthly_cents;

    if v_selected_cycle = 'mensal' then
      v_monthly_access_units := v_monthly_access_units + v_quantity;
      v_monthly_access_regular_cents := v_monthly_access_regular_cents + v_subtotal_monthly_cents;
    end if;
  end loop;

  v_monthly_access_discounted_cents := v_monthly_access_regular_cents;
  if v_monthly_access_units = 2 then
    v_monthly_access_discounted_cents := least(v_monthly_access_regular_cents, 4790);
  elsif v_monthly_access_units = 3 then
    v_monthly_access_discounted_cents := least(v_monthly_access_regular_cents, 5490);
  elsif v_monthly_access_units = 4 then
    v_monthly_access_discounted_cents := least(v_monthly_access_regular_cents, 6990);
  end if;

  if v_monthly_access_discounted_cents < v_monthly_access_regular_cents then
    v_expected_total_monthly_cents := v_expected_total_monthly_cents - (v_monthly_access_regular_cents - v_monthly_access_discounted_cents);
  end if;

  v_sent_total_plan_cents := coalesce((v_order.metadata->>'total_plan_cents')::integer, 0);
  if v_sent_total_plan_cents > 0 and v_sent_total_plan_cents <> v_expected_total_plan_cents then
    update public.checkout_orders
      set status = 'failed',
          metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
            'price_validation', jsonb_build_object(
              'status', 'order_plan_total_mismatch',
              'sent_total_plan_cents', v_sent_total_plan_cents,
              'expected_total_plan_cents', v_expected_total_plan_cents,
              'validated_at', timezone('utc'::text, now())
            )
          )
    where id = v_order.id;

    return jsonb_build_object('status', 'price_validation_failed', 'reason', 'order_plan_total_mismatch', 'order_id', v_order.id);
  end if;

  v_sent_total_monthly_cents := coalesce((v_order.metadata->>'total_monthly_cents')::integer, 0);
  if v_sent_total_monthly_cents > 0 and v_sent_total_monthly_cents <> v_expected_total_monthly_cents then
    update public.checkout_orders
      set status = 'failed',
          metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
            'price_validation', jsonb_build_object(
              'status', 'order_monthly_total_mismatch',
              'sent_total_monthly_cents', v_sent_total_monthly_cents,
              'expected_total_monthly_cents', v_expected_total_monthly_cents,
              'validated_at', timezone('utc'::text, now())
            )
          )
    where id = v_order.id;

    return jsonb_build_object('status', 'price_validation_failed', 'reason', 'order_monthly_total_mismatch', 'order_id', v_order.id);
  end if;

  v_credit := greatest(coalesce(v_order.purchased_credit, 0), 0);

  update public.checkout_orders
    set status = 'paid',
        paid_at = timezone('utc'::text, now()),
        metadata = coalesce(v_order.metadata, '{}'::jsonb) || jsonb_build_object(
          'validated_pricing', jsonb_build_object(
            'total_plan_cents', v_expected_total_plan_cents,
            'total_monthly_cents', v_expected_total_monthly_cents,
            'validated_at', timezone('utc'::text, now())
          )
        )
  where id = v_order.id;

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
      v_order.profile_id,
      'credit',
      v_credit,
      'checkout_paid',
      v_order.id::text,
      'Crédito aprovado via checkout',
      jsonb_build_object('provider_order_id', p_provider_order_id)
    );
  exception
    when unique_violation then
      null;
  end;

  insert into public.wallet_balances (profile_id, balance)
  values (v_order.profile_id, v_credit)
  on conflict (profile_id)
  do update set balance = public.wallet_balances.balance + excluded.balance,
                updated_at = timezone('utc'::text, now());

  return jsonb_build_object('status', 'paid_applied', 'order_id', v_order.id, 'credit', v_credit);
end;
$$;

revoke all on function public.apply_checkout_paid_event(text, text, text, text, jsonb) from public;
grant execute on function public.apply_checkout_paid_event(text, text, text, text, jsonb) to service_role;

-- 9) Seed inicial de produtos (placeholders)
insert into public.store_products (slug, name, description, product_type, credit_cost, allow_multiple_units, is_highlight, is_active, is_visible, sort_order)
values
  ('ia-portugues', 'Acesso IA Português', 'Acesso unitário para 1 IA de Português.', 'acesso', 120, true, false, true, true, 10),
  ('ia-matematica', 'Acesso IA Matemática', 'Acesso unitário para 1 IA de Matemática.', 'acesso', 140, true, false, true, true, 20),
  ('combo-3-acessos', 'Combo 3 Acessos', 'Pacote com 3 acessos com valor reduzido.', 'combo', 330, true, true, true, true, 30)
on conflict (slug) do nothing;

-- 10) Planos de recarga de saldo (valores configuráveis)
create table if not exists public.wallet_topup_plans (
  id uuid default uuid_generate_v4() primary key,
  slug text unique not null,
  name text not null,
  description text,
  credit_amount integer not null check (credit_amount > 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'BRL',
  bonus_percent numeric(5,2) not null default 0,
  is_active boolean not null default true,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists wallet_topup_plans_sort_order_idx
  on public.wallet_topup_plans(sort_order);

drop trigger if exists touch_wallet_topup_plans_updated_at on public.wallet_topup_plans;
create trigger touch_wallet_topup_plans_updated_at
before update on public.wallet_topup_plans
for each row execute procedure public.touch_updated_at();

alter table public.wallet_topup_plans enable row level security;

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

insert into public.wallet_topup_plans (slug, name, description, credit_amount, price_cents, currency, bonus_percent, is_active, is_visible, sort_order)
values
  ('recarga-basica', 'Recarga Básica', 'Plano inicial de créditos.', 300, 3990, 'BRL', 0, true, true, 10),
  ('recarga-plus', 'Recarga Plus', 'Mais créditos com bônus.', 800, 8990, 'BRL', 10, true, true, 20),
  ('recarga-pro', 'Recarga Pro', 'Maior volume para uso frequente.', 1800, 17990, 'BRL', 15, true, true, 30)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
