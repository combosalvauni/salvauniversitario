-- Fix Supabase advisory: Function Search Path Mutable
-- Safe to run on the current database.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;