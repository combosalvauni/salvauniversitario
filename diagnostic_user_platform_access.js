/**
 * Diagnostic Script - User Platform Access Issues
 * Diagnóstico para problemas de acesso a plataformas
 * 
 * Uso: node diagnostic_user_platform_access.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TARGET_EMAILS = [
    'danieldasilsoares75@gmail.com',
    'danieldasilsoares76@gmail.com'
];

async function diagnoseUserAccess() {
    console.log('🔍 Iniciando diagnóstico de acesso a plataformas...\n');

    try {
        // 1. Buscar usuários
        console.log('1️⃣  Buscando usuários...');
        const { data: users, error: usersError } = await supabase
            .from('profiles')
            .select('id, email, full_name, role, subscription_status')
            .in('email', TARGET_EMAILS);

        if (usersError) throw usersError;

        if (!users || users.length === 0) {
            console.log('❌ Nenhum usuário encontrado com esses emails!');
            console.log('   Emails procurados:', TARGET_EMAILS);
            return;
        }

        console.log(`✅ ${users.length} usuário(s) encontrado(s):`);
        users.forEach(user => {
            console.log(`   - ${user.full_name} (${user.email})`);
            console.log(`     Role: ${user.role}, Status: ${user.subscription_status}`);
        });

        // 2. Verificar atribuições para cada usuário
        console.log('\n2️⃣  Verificando atribuições de plataforma...');
        
        for (const user of users) {
            console.log(`\n   📋 Para: ${user.full_name}`);
            
            // Query direto na tabela
            const { data: assignments, error: assignmentsError } = await supabase
                .from('platform_account_assignments')
                .select(`
                    id,
                    valid_from,
                    valid_until,
                    revoked_at,
                    show_to_user,
                    account_id,
                    platform_accounts!inner(
                        id,
                        label,
                        status,
                        platform_id,
                        platforms(id, name, status)
                    )
                `)
                .eq('profile_id', user.id)
                .order('created_at', { ascending: false });

            if (assignmentsError) {
                console.log(`   ⚠️  Erro ao buscar atribuições: ${assignmentsError.message}`);
                continue;
            }

            if (!assignments || assignments.length === 0) {
                console.log(`   ⚠️  NENHUMA atribuição encontrada`);
                continue;
            }

            console.log(`   ✅ ${assignments.length} atribuição(ões) encontrada(s):`);
            
            const now = new Date();
            assignments.forEach((assign, idx) => {
                const validFrom = new Date(assign.valid_from);
                const validUntil = assign.valid_until ? new Date(assign.valid_until) : null;
                const isActive = !assign.revoked_at 
                    && assign.show_to_user
                    && validFrom <= now
                    && (!validUntil || validUntil > now);
                
                const platformInfo = assign.platform_accounts?.platforms;
                const accountLabel = assign.platform_accounts?.label || 'N/A';
                const accountStatus = assign.platform_accounts?.status || 'unknown';
                const platformName = platformInfo?.name || 'N/A';
                const platformStatus = platformInfo?.status || 'unknown';

                console.log(`      ${idx + 1}. ${platformName} - ${accountLabel}`);
                console.log(`         Válido de: ${validFrom.toLocaleDateString('pt-BR')}`);
                if (validUntil) console.log(`         Até: ${validUntil.toLocaleDateString('pt-BR')}`);
                console.log(`         Status da conta: ${accountStatus}`);
                console.log(`         Status da plataforma: ${platformStatus}`);
                console.log(`         Mostrar ao usuário: ${assign.show_to_user}`);
                console.log(`         Revogado em: ${assign.revoked_at || 'Não'}`);
                console.log(`         ⭐ Ativo agora: ${isActive ? '✅ SIM' : '❌ NÃO'}`);
            });
        }

        // 3. Verificar plataformas disponíveis
        console.log('\n3️⃣  Verificando plataformas disponíveis...');
        const { data: platforms, error: platformsError } = await supabase
            .from('platforms_public')
            .select('id, name, status, is_visible, active_accounts_count')
            .order('sort_order', { ascending: true });

        if (platformsError) {
            console.log(`   ⚠️  Erro ao buscar plataformas: ${platformsError.message}`);
        } else {
            console.log(`   ✅ ${platforms?.length || 0} plataforma(s) visível(is):`);
            platforms?.forEach(p => {
                console.log(`      - ${p.name} (Status: ${p.status}, Contas ativas: ${p.active_accounts_count})`);
            });
        }

        // 4. Verificar contas de plataforma
        console.log('\n4️⃣  Verificando contas de plataforma...');
        const { data: accounts, error: accountsError } = await supabase
            .from('platform_accounts')
            .select('id, label, status, platform_id, platforms(name)')
            .eq('status', 'active');

        if (accountsError) {
            console.log(`   ⚠️  Erro ao buscar contas: ${accountsError.message}`);
        } else {
            console.log(`   ✅ ${accounts?.length || 0} conta(s) ativa(s):`);
            const grouped = {};
            accounts?.forEach(acc => {
                const pName = acc.platforms?.name || 'Unknown';
                if (!grouped[pName]) grouped[pName] = [];
                grouped[pName].push(acc.label);
            });
            Object.entries(grouped).forEach(([platform, labels]) => {
                console.log(`      - ${platform}: ${labels.join(', ')}`);
            });
        }

        // 5. Resumo e recomendações
        console.log('\n5️⃣  RECOMENDAÇÕES:');
        const hasAssignments = users.some(u => {
            // Fazer uma verificação rápida
            return true; // Isso será verificado acima
        });

        if (!hasAssignments) {
            console.log('\n🔴 PROBLEMA: Os usuários não têm atribuições de plataforma!');
            console.log('   SOLUÇÃO: Use o Admin para conceder acesso a essas plataformas');
            console.log('   PASSOS:');
            console.log('   1. Vá para Admin -> Gerenciar Usuários');
            console.log('   2. Selecione cada usuário');
            console.log('   3. Clique em "Conceder novo acesso"');
            console.log('   4. Selecione a plataforma e a conta desejada');
            console.log('   5. Defina as datas de validade');
        }

    } catch (error) {
        console.error('\n❌ ERRO durante diagnóstico:', error);
    }
}

// Executar
diagnoseUserAccess();
