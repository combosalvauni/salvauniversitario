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

notify pgrst, 'reload schema';
