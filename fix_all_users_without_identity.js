/**
 * Script de correção em massa para usuários sem identidade
 * ATENÇÃO: Este script corrige TODOS os usuários sem identidade
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Senha padrão temporária para todos os usuários
const DEFAULT_TEMP_PASSWORD = 'TempSenha@2026';

async function fixAllUsersWithoutIdentity() {
    console.log('🔧 CORREÇÃO EM MASSA - Usuários sem identidade\n');
    console.log('⚠️  ATENÇÃO: Todos os usuários receberão a senha temporária:', DEFAULT_TEMP_PASSWORD);
    console.log('   Você deverá informar aos usuários para resetarem a senha.\n');

    try {
        // 1. Buscar todos os usuários
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;

        console.log(`📊 Total de usuários: ${users.length}\n`);

        // 2. Filtrar usuários sem identidade
        const usersWithoutIdentity = users.filter(u => !u.identities || u.identities.length === 0);

        console.log(`❌ Usuários sem identidade: ${usersWithoutIdentity.length}`);
        console.log(`✅ Usuários com identidade: ${users.length - usersWithoutIdentity.length}\n`);

        if (usersWithoutIdentity.length === 0) {
            console.log('✅ Nenhum usuário precisa de correção!');
            return;
        }

        console.log('🔄 Iniciando correção...\n');

        const results = {
            success: [],
            failed: []
        };

        // 3. Corrigir cada usuário
        for (let i = 0; i < usersWithoutIdentity.length; i++) {
            const user = usersWithoutIdentity[i];
            const progress = `[${i + 1}/${usersWithoutIdentity.length}]`;

            console.log(`${progress} Corrigindo: ${user.email}`);

            try {
                // Atualizar senha para forçar criação de identidade
                const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
                    user.id,
                    { 
                        password: DEFAULT_TEMP_PASSWORD,
                        email_confirm: true
                    }
                );

                if (updateError) {
                    console.log(`   ❌ Erro: ${updateError.message}`);
                    results.failed.push({ email: user.email, error: updateError.message });
                    continue;
                }

                // Verificar se identidade foi criada
                const identityCount = updateData.user.identities?.length || 0;

                if (identityCount > 0) {
                    console.log(`   ✅ Identidade criada (${identityCount})`);
                    results.success.push(user.email);
                } else {
                    console.log(`   ⚠️  Identidade não foi criada automaticamente`);
                    results.failed.push({ email: user.email, error: 'Identidade não criada' });
                }

                // Pequeno delay para não sobrecarregar a API
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.log(`   ❌ Erro: ${error.message}`);
                results.failed.push({ email: user.email, error: error.message });
            }
        }

        // 4. Resumo final
        console.log('\n\n=== RESUMO DA CORREÇÃO ===\n');
        console.log(`✅ Corrigidos com sucesso: ${results.success.length}`);
        console.log(`❌ Falharam: ${results.failed.length}`);

        if (results.failed.length > 0) {
            console.log('\n❌ Usuários que falharam:');
            results.failed.forEach(f => {
                console.log(`   - ${f.email}: ${f.error}`);
            });
        }

        // 5. Verificação final
        console.log('\n🔍 Verificação final...');
        const { data: { users: finalUsers } } = await supabase.auth.admin.listUsers();
        const stillWithoutIdentity = finalUsers.filter(u => !u.identities || u.identities.length === 0);

        console.log(`\n📊 Resultado final:`);
        console.log(`   Total de usuários: ${finalUsers.length}`);
        console.log(`   Com identidade: ${finalUsers.length - stillWithoutIdentity.length}`);
        console.log(`   Sem identidade: ${stillWithoutIdentity.length}`);

        if (stillWithoutIdentity.length === 0) {
            console.log('\n🎉🎉🎉 TODOS OS USUÁRIOS FORAM CORRIGIDOS! 🎉🎉🎉');
        } else {
            console.log(`\n⚠️  Ainda há ${stillWithoutIdentity.length} usuário(s) sem identidade.`);
            console.log('   Estes usuários podem precisar de correção manual.');
        }

        // 6. Salvar relatório
        const report = {
            timestamp: new Date().toISOString(),
            totalUsers: users.length,
            usersFixed: results.success.length,
            usersFailed: results.failed.length,
            tempPassword: DEFAULT_TEMP_PASSWORD,
            successList: results.success,
            failedList: results.failed
        };

        const fs = await import('fs');
        fs.writeFileSync(
            'fix_users_report.json',
            JSON.stringify(report, null, 2)
        );

        console.log('\n📄 Relatório salvo em: fix_users_report.json');

        // 7. Instruções para os usuários
        console.log('\n\n=== PRÓXIMOS PASSOS ===\n');
        console.log('📧 COMUNICAR AOS USUÁRIOS:');
        console.log('   1. Todos os usuários devem usar a senha temporária para fazer login:');
        console.log(`      Senha: ${DEFAULT_TEMP_PASSWORD}`);
        console.log('   2. Após o login, solicite que alterem a senha imediatamente');
        console.log('   3. Ou implemente um fluxo de "Esqueci minha senha" para cada usuário\n');

        console.log('🔧 IMPLEMENTAR RECUPERAÇÃO DE SENHA:');
        console.log('   1. Ative o link "Esqueceu a senha?" no Login.jsx:310');
        console.log('   2. Configure o email de recuperação no Supabase');
        console.log('   3. Crie uma página de reset de senha\n');

        console.log('🛡️  PREVENÇÃO FUTURA:');
        console.log('   1. Execute check_all_users_integrity.js semanalmente');
        console.log('   2. Implemente um health check automático');
        console.log('   3. Monitore a criação de novos usuários');
        console.log('   4. Sempre use updateUserById() após criar usuário\n');

    } catch (error) {
        console.error('\n❌ ERRO CRÍTICO:', error.message);
        console.error(error.stack);
    }
}

fixAllUsersWithoutIdentity();
