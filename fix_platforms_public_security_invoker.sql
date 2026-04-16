-- Fix Supabase warning: public.platforms_public should not run as SECURITY DEFINER.
-- Execute this on existing environments where the view has already been created.

alter view public.platforms_public
set (security_invoker = true);