-- ══════════════════════════════════════════════════════════════
-- FIX: Supabase RLS - Profiles table leaking emails via anon key
-- ══════════════════════════════════════════════════════════════
-- PROBLEM: Policy "Public profiles are viewable by everyone."
--   allows anon key to SELECT all profiles including emails.
-- SOLUTION: Remove the public policy. "Users can view own profile"
--   already covers authenticated users reading their own data.
--   Backend uses service_role key (bypasses RLS) so no impact.
--
-- Also cleans up duplicate policies found:
--   - "Users can insert own profile" + "Users can insert their own profile."
--   - "Users can update own profile" + "Users can update own profile."
--
-- Run ALL of this in Supabase SQL Editor (Dashboard > SQL > New Query):
-- ══════════════════════════════════════════════════════════════

-- 1. Remove the public SELECT policy (the security leak)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON profiles;

-- 2. Remove duplicate INSERT policies (keep "Users can insert own profile")
DROP POLICY IF EXISTS "Users can insert their own profile." ON profiles;

-- 3. Remove duplicate UPDATE policies (keep "Users can update own profile")
DROP POLICY IF EXISTS "Users can update own profile." ON profiles;

-- 4. Verify remaining policies (should be 5):
--    - Admins can update any profile
--    - Admins can view all profiles
--    - Users can insert own profile
--    - Users can update own profile  (the one WITHOUT period)
--    - Users can view own profile
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
