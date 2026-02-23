-- New users should start as teste-gratis
alter table public.profiles alter column subscription_status set default 'teste-gratis';

-- Keep insert policy aligned (idempotent)
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (
    auth.uid() = id
    and role = 'student'
    and subscription_status = 'teste-gratis'
    and email = (auth.jwt() ->> 'email')
  );

-- Ensure Teste Grátis duration is 3 days
update public.subscription_plans
set period_text = '/3 dias'
where slug = 'teste-gratis';

notify pgrst, 'reload schema';
