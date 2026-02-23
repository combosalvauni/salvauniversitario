-- Validação de preços promocionais por ciclo no webhook de checkout
-- Execute no Supabase SQL Editor

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

notify pgrst, 'reload schema';
