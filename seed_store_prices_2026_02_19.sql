-- Seed de preços mensais (baseado nos valores enviados em 19/02/2026)
-- Usa metadata.price_monthly_cents para manter compatibilidade com schema atual.

insert into public.store_products (slug, name, description, product_type, credit_cost, allow_multiple_units, is_highlight, is_active, is_visible, sort_order, metadata)
values
  ('proenem', 'ProEnem', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 100, jsonb_build_object('price_monthly_cents', 3790)),
  ('promedicina', 'ProMedicina', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 110, jsonb_build_object('price_monthly_cents', 4790)),
  ('gran-concurso', 'Gran Concurso', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 120, jsonb_build_object('price_monthly_cents', 2590)),
  ('tec-concursos-adv', 'Tec Concursos Adv', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 130, jsonb_build_object('price_monthly_cents', 2490)),
  ('focus', 'Focus', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 140, jsonb_build_object('price_monthly_cents', 2590)),
  ('direcao-concurso', 'Direção Concurso', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 150, jsonb_build_object('price_monthly_cents', 2790)),
  ('rani-passos', 'Rani Passos', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 160, jsonb_build_object('price_monthly_cents', 2490)),
  ('gamma-aithor', 'Gamma / Aithor', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 170, jsonb_build_object('price_monthly_cents', 2490)),
  ('chatgpt-plus', 'ChatGPT Plus', 'Acesso individual mensal', 'acesso', 0, true, false, true, true, 180, jsonb_build_object('price_monthly_cents', 2990)),

  ('combo-2-acessos-mensal', '2 acessos (mensal)', 'Pacote combinado mensal', 'combo', 0, true, true, true, true, 200, jsonb_build_object('price_monthly_cents', 4790)),
  ('combo-3-acessos-mensal', '3 acessos (mensal)', 'Pacote combinado mensal', 'combo', 0, true, true, true, true, 210, jsonb_build_object('price_monthly_cents', 5490)),
  ('combo-4-acessos-mensal', '4 acessos (mensal)', 'Pacote combinado mensal', 'combo', 0, true, true, true, true, 220, jsonb_build_object('price_monthly_cents', 6990)),

  ('gran-ilimitado-economico', 'Gran ilimitado (econômico)', 'Planos trimestral/semestral/anual', 'plano_personalizado', 0, false, true, true, true, 300,
    jsonb_build_object(
      'plans', jsonb_build_array(
        jsonb_build_object('cycle', 'trimestral', 'price_cents', 6990),
        jsonb_build_object('cycle', 'semestral', 'price_cents', 12990),
        jsonb_build_object('cycle', 'anual', 'price_cents', 18990)
      )
    )
  ),
  ('2-acessos-economico', '2 acessos (econômico)', 'Planos trimestral/semestral/anual', 'plano_personalizado', 0, false, true, true, true, 310,
    jsonb_build_object(
      'plans', jsonb_build_array(
        jsonb_build_object('cycle', 'trimestral', 'price_cents', 13490),
        jsonb_build_object('cycle', 'semestral', 'price_cents', 22990),
        jsonb_build_object('cycle', 'anual', 'price_cents', 24990)
      )
    )
  ),
  ('3-acessos-economico', '3 acessos (econômico)', 'Planos trimestral/semestral/anual', 'plano_personalizado', 0, false, true, true, true, 320,
    jsonb_build_object(
      'plans', jsonb_build_array(
        jsonb_build_object('cycle', 'trimestral', 'price_cents', 14990),
        jsonb_build_object('cycle', 'semestral', 'price_cents', 26990),
        jsonb_build_object('cycle', 'anual', 'price_cents', 38990)
      )
    )
  ),
  ('4-acessos-economico', '4 acessos (econômico)', 'Planos trimestral/semestral/anual', 'plano_personalizado', 0, false, true, true, true, 330,
    jsonb_build_object(
      'plans', jsonb_build_array(
        jsonb_build_object('cycle', 'trimestral', 'price_cents', 15490),
        jsonb_build_object('cycle', 'semestral', 'price_cents', 27990),
        jsonb_build_object('cycle', 'anual', 'price_cents', 39990)
      )
    )
  )
on conflict (slug)
do update set
  name = excluded.name,
  description = excluded.description,
  product_type = excluded.product_type,
  credit_cost = excluded.credit_cost,
  allow_multiple_units = excluded.allow_multiple_units,
  is_highlight = excluded.is_highlight,
  is_active = excluded.is_active,
  is_visible = excluded.is_visible,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata;

notify pgrst, 'reload schema';
