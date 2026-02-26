-- Checkout: confirmação de pagamento + liberação automática de acesso
-- Execute após `setup_wallet_store_checkout.sql` e `supabase_setup.sql`

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

notify pgrst, 'reload schema';
