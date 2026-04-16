/**
 * Script para verificar integridade de todos os usuários
 * Identifica usuários sem identidade que não conseguem fazer login
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllUsers() {
    console.log('🔍 Verificando integridade de todos os usuários...\n');

    try {
        // 1. Buscar todos os usuários
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;

        console.log(`📊 Total de usuários: ${users.length}\n`);

        // 2. Analisar cada usuário
        const usersWithoutIdentity = [];
        const usersWithIdentity = [];
        const userStats = {
            total: users.length,
            withIdentity: 0,
            withoutIdentity: 0,
            emailConfirmed: 0,
            emailNotConfirmed: 0,
            banned: 0
        };

        console.log('=== ANÁLISE DE USUÁRIOS ===\n');

        for (const user of users) {
            const identityCount = user.identities?.length || 0;
            const hasIdentity = identityCount > 0;
            const isConfirmed = Boolean(user.email_confirmed_at);
            const isBanned = Boolean(user.banned_until);

            if (hasIdentity) {
                userStats.withIdentity++;
                usersWithIdentity.push(user);
            } else {
                userStats.withoutIdentity++;
                usersWithoutIdentity.push(user);
            }

            if (isConfirmed) userStats.emailConfirmed++;
            else userStats.emailNotConfirmed++;

            if (isBanned) userStats.banned++;

            // Mostrar apenas usuários com problema
            if (!hasIdentity) {
                console.log(`❌ ${user.email}`);
                console.log(`   ID: ${user.id}`);
                console.log(`   Identidades: ${identityCount}`);
                console.log(`   Email confirmado: ${isConfirmed ? 'Sim' : 'NÃO'}`);
                console.log(`   Criado em: ${new Date(user.created_at).toLocaleString('pt-BR')}`);
                console.log(`   Último login: ${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : 'Nunca'}`);
                console.log('');
            }
        }

        // 3. Resumo
        console.log('\n=== RESUMO ===\n');
        console.log(`📊 Total de usuários: ${userStats.total}`);
        console.log(`✅ Com identidade: ${userStats.withIdentity} (${((userStats.withIdentity / userStats.total) * 100).toFixed(1)}%)`);
        console.log(`❌ Sem identidade: ${userStats.withoutIdentity} (${((userStats.withoutIdentity / userStats.total) * 100).toFixed(1)}%)`);
        console.log(`📧 Email confirmado: ${userStats.emailConfirmed}`);
        console.log(`📧 Email não confirmado: ${userStats.emailNotConfirmed}`);
        console.log(`🚫 Banidos: ${userStats.banned}`);

        // 4. Verificar profiles
        if (usersWithoutIdentity.length > 0) {
            console.log('\n\n=== USUÁRIOS SEM IDENTIDADE (PROBLEMA CRÍTICO) ===\n');
            
            for (const user of usersWithoutIdentity) {
                console.log(`\n📧 ${user.email}`);
                
                // Buscar profile
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('full_name, role, subscription_status')
                    .eq('id', user.id)
                    .single();

                if (profileError) {
                    console.log('   ⚠️  Profile não encontrado');
                } else {
                    console.log(`   Nome: ${profile.full_name || 'N/A'}`);
                    console.log(`   Role: ${profile.role}`);
                    console.log(`   Status: ${profile.subscription_status}`);
                }

                // Buscar atribuições
                const { data: assignments, error: assignError } = await supabase
                    .from('platform_account_assignments')
                    .select('id')
                    .eq('profile_id', user.id);

                if (!assignError && assignments) {
                    console.log(`   Plataformas: ${assignments.length}`);
                }
            }

            console.log('\n\n⚠️  ATENÇÃO: Estes usuários NÃO CONSEGUEM FAZER LOGIN!');
            console.log('   Eles precisam ser corrigidos usando o script de correção.\n');
        } else {
            console.log('\n\n✅ TODOS OS USUÁRIOS ESTÃO OK!');
            console.log('   Nenhum usuário sem identidade detectado.\n');
        }

        // 5. Recomendações
        console.log('\n=== RECOMENDAÇÕES ===\n');

        if (userStats.withoutIdentity > 0) {
            console.log('🔧 AÇÃO NECESSÁRIA:');
            console.log('   Execute o script de correção para usuários sem identidade:');
            console.log('   node fix_users_without_identity.js\n');
        }

        if (userStats.emailNotConfirmed > 0) {
            console.log('📧 EMAILS NÃO CONFIRMADOS:');
            console.log(`   ${userStats.emailNotConfirmed} usuário(s) não confirmaram o email.`);
            console.log('   Considere implementar reenvio de email de confirmação.\n');
        }

        console.log('💡 PREVENÇÃO:');
        console.log('   1. Sempre use admin.createUser() para criar usuários via admin');
        console.log('   2. Sempre chame updateUserById() com password após criar usuário');
        console.log('   3. Monitore regularmente com este script');
        console.log('   4. Implemente um health check automático\n');

        // 6. Salvar relatório
        const report = {
            timestamp: new Date().toISOString(),
            stats: userStats,
            usersWithoutIdentity: usersWithoutIdentity.map(u => ({
                email: u.email,
                id: u.id,
                created_at: u.created_at,
                last_sign_in_at: u.last_sign_in_at
            }))
        };

        console.log('📄 Relatório salvo em: user_integrity_report.json\n');
        
        const fs = await import('fs');
        fs.writeFileSync(
            'user_integrity_report.json',
            JSON.stringify(report, null, 2)
        );

    } catch (error) {
        console.error('\n❌ ERRO:', error.message);
    }
}

checkAllUsers();
