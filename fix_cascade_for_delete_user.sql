-- =============================================
-- FIX: Add ON DELETE CASCADE to ALL foreign keys
-- referencing auth.users or profiles
-- Run this in Supabase SQL Editor
-- =============================================

-- 1) First, discover all FK constraints referencing auth.users or profiles
-- that DON'T have CASCADE. Run this query first to see what needs fixing:

/*
SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_schema AS foreign_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND (
        (ccu.table_schema = 'auth' AND ccu.table_name = 'users')
        OR (ccu.table_schema = 'public' AND ccu.table_name = 'profiles')
    )
    AND rc.delete_rule != 'CASCADE'
ORDER BY tc.table_schema, tc.table_name;
*/

-- 2) Fix profiles -> auth.users (the root FK)
DO $$
DECLARE
    v_constraint_name text;
BEGIN
    -- profiles.id -> auth.users.id
    SELECT tc.constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'profiles'
    AND kcu.column_name = 'id'
    AND ccu.table_schema = 'auth' AND ccu.table_name = 'users'
    AND rc.delete_rule != 'CASCADE'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_constraint_name);
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_id_fkey
            FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
        RAISE NOTICE 'Fixed: profiles.id -> auth.users.id (CASCADE)';
    ELSE
        RAISE NOTICE 'OK: profiles.id -> auth.users.id already CASCADE or not found';
    END IF;
END $$;

-- 3) Fix ALL tables that reference profiles.id
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_schema = 'public' AND ccu.table_name = 'profiles' AND ccu.column_name = 'id'
        AND rc.delete_rule != 'CASCADE'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
            rec.table_schema, rec.table_name, rec.constraint_name);
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE CASCADE',
            rec.table_schema, rec.table_name, rec.constraint_name, rec.column_name);
        RAISE NOTICE 'Fixed: %.% (%) -> profiles.id (CASCADE)', rec.table_schema, rec.table_name, rec.column_name;
    END LOOP;
END $$;

-- 4) Fix ALL tables that reference auth.users directly (not via profiles)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_schema = 'auth' AND ccu.table_name = 'users'
        AND tc.table_schema = 'public'  -- only fix public schema tables
        AND NOT (tc.table_name = 'profiles' AND kcu.column_name = 'id')  -- skip profiles, already fixed
        AND rc.delete_rule != 'CASCADE'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
            rec.table_schema, rec.table_name, rec.constraint_name);
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE CASCADE',
            rec.table_schema, rec.table_name, rec.constraint_name, rec.column_name);
        RAISE NOTICE 'Fixed: %.% (%) -> auth.users.id (CASCADE)', rec.table_schema, rec.table_name, rec.column_name;
    END LOOP;
END $$;

-- 5) Verify: show all remaining non-CASCADE FKs to auth.users or profiles
SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_schema AS ref_schema,
    ccu.table_name AS ref_table,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND (
    (ccu.table_schema = 'auth' AND ccu.table_name = 'users')
    OR (ccu.table_schema = 'public' AND ccu.table_name = 'profiles')
)
ORDER BY rc.delete_rule, tc.table_schema, tc.table_name;
