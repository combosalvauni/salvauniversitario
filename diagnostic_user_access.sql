-- Script de Diagnóstico para Acesso a Plataformas
-- Análise para: daniel, Daniele Manhães

-- 1. Verificar se os usuários existem no sistema
SELECT 
    id,
    email,
    full_name,
    role,
    subscription_status,
    created_at
FROM public.profiles 
WHERE email IN ('danieldasilsoares75@gmail.com', 'danieldasilsoares76@gmail.com');

-- 2. Verificar atribuições de plataforma para esses usuários
SELECT 
    paa.id,
    paa.profile_id,
    p.full_name,
    p.email,
    pa.label as account_label,
    plat.name as platform_name,
    paa.valid_from,
    paa.valid_until,
    paa.revoked_at,
    paa.show_to_user,
    paa.created_at
FROM public.platform_account_assignments paa
JOIN public.platform_accounts pa ON paa.account_id = pa.id
JOIN public.platforms plat ON pa.platform_id = plat.id
JOIN public.profiles p ON paa.profile_id = p.id
WHERE p.email IN ('danieldasilsoares75@gmail.com', 'danieldasilsoares76@gmail.com')
ORDER BY paa.created_at DESC;

-- 3. Verificar se a tabela platform_account_assignments tem dados corrompidos
SELECT 
    COUNT(*) as total_assignments,
    COUNT(CASE WHEN account_id IS NULL THEN 1 END) as null_account_ids,
    COUNT(CASE WHEN profile_id IS NULL THEN 1 END) as null_profile_ids,
    COUNT(CASE WHEN valid_from IS NULL THEN 1 END) as null_valid_from,
    MIN(created_at) as oldest_assignment,
    MAX(created_at) as newest_assignment
FROM public.platform_account_assignments;

-- 4. Verificar se há problemas com as referências de chave estrangeira
SELECT 
    paa.id,
    paa.account_id,
    paa.profile_id,
    CASE WHEN pa.id IS NULL THEN 'ACCOUNT MISSING' ELSE 'OK' END as account_status,
    CASE WHEN prof.id IS NULL THEN 'PROFILE MISSING' ELSE 'OK' END as profile_status
FROM public.platform_account_assignments paa
LEFT JOIN public.platform_accounts pa ON paa.account_id = pa.id
LEFT JOIN public.profiles prof ON paa.profile_id = prof.id
WHERE pa.id IS NULL OR prof.id IS NULL
LIMIT 20;

-- 5. Verificar plataformas e contas disponíveis
SELECT 
    p.id,
    p.name,
    p.status,
    p.is_visible,
    COUNT(pa.id) as total_accounts,
    COUNT(CASE WHEN pa.status = 'active' THEN 1 END) as active_accounts
FROM public.platforms p
LEFT JOIN public.platform_accounts pa ON pa.platform_id = p.id
GROUP BY p.id, p.name, p.status, p.is_visible
ORDER BY p.name;

-- 6. Verificar se há profiles ativas e usuários com role student (como esses dois)
SELECT 
    id,
    email,
    full_name,
    role,
    subscription_status,
    can_access_store,
    created_at
FROM public.profiles 
WHERE role = 'student'
AND subscription_status IN ('teste-gratis', 'ativo')
ORDER BY created_at DESC
LIMIT 10;

-- 7. Verificar atribuições válidas para hoje (sem considerar o usuário específico)
SELECT 
    COUNT(*) as total_valid_assignments,
    COUNT(DISTINCT profile_id) as users_with_access,
    COUNT(DISTINCT pa.platform_id) as platforms_assigned
FROM public.platform_account_assignments paa
JOIN public.platform_accounts pa ON paa.account_id = pa.id
WHERE paa.revoked_at IS NULL
AND paa.show_to_user = true
AND paa.valid_from <= NOW()
AND (paa.valid_until IS NULL OR paa.valid_until > NOW())
AND pa.status = 'active';
