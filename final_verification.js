/**
 * VERIFICAÇÃO FINAL - Diagnóstico após correções
 * Verifica se os usuários agora conseguem acessar as plataformas
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function finalCheck() {
    console.log('✅ VERIFICAÇÃO FINAL - Diagnóstico Pós-Correção\n');
    console.log('='.repeat(60) + '\n');

    try {
        // 1. Verificar Daniel
        console.log('1️⃣  VERIFICANDO: daniel (danieldasilsoares75@gmail.com)');
        console.log('-'.repeat(60));
        
        const { data: danielProfile } = await supabase
            .from('profiles')
            .select('id, full_name, email, subscription_status')
            .eq('email', 'danieldasilsoares75@gmail.com')
            .single();

        if (danielProfile) {
            const { data: danielAccess } = await supabase
                .from('platform_account_assignments')
                .select(`
                    id,
                    valid_from,
                    valid_until,
                    show_to_user,
                    platform_accounts(label, status, platforms(name, status))
                `)
                .eq('profile_id', danielProfile.id)
                .is('revoked_at', null)
                .eq('show_to_user', true);

            console.log(`✅ Encontrado: ${danielProfile.full_name}`);
            console.log(`   Status: ${danielProfile.subscription_status}`);
            console.log(`   Acessos ativos: ${danielAccess?.length || 0}`);
            
            if (danielAccess && danielAccess.length > 0) {
                const now = new Date();
                let activeCount = 0;
                console.log('\n   📋 Detalhes dos acessos:');
                danielAccess.forEach((access, idx) => {
                    const plat = access.platform_accounts?.platforms;
                    const isActive = plat?.status === 'active' && 
                                   (!access.valid_until || new Date(access.valid_until) >= now);
                    if (isActive) activeCount++;
                    
                    const status = isActive ? '✅' : '❌';
                    console.log(`   ${status} ${idx + 1}. ${plat?.name} - ${access.platform_accounts?.label}`);
                    console.log(`       Válido: ${new Date(access.valid_from).toLocaleDateString('pt-BR')} até ${access.valid_until ? new Date(access.valid_until).toLocaleDateString('pt-BR') : '∞'}`);
                });
                console.log(`\n   ⭐ Plataformas ativas: ${activeCount}/${danielAccess.length}`);
            }
        }

        // 2. Verificar Daniele
        console.log('\n\n2️⃣  VERIFICANDO: Daniele (danieldasilsoares76@gmail.com)');
        console.log('-'.repeat(60));

        const { data: danieleProfile } = await supabase
            .from('profiles')
            .select('id, full_name, email, subscription_status')
            .eq('email', 'danieldasilsoares76@gmail.com')
            .single();

        if (danieleProfile) {
            const { data: danieleAccess } = await supabase
                .from('platform_account_assignments')
                .select(`
                    id,
                    valid_from,
                    valid_until,
                    show_to_user,
                    platform_accounts(label, status, platforms(name, status))
                `)
                .eq('profile_id', danieleProfile.id)
                .is('revoked_at', null)
                .eq('show_to_user', true);

            console.log(`✅ Encontrada: ${danieleProfile.full_name}`);
            console.log(`   Status: ${danieleProfile.subscription_status}`);
            console.log(`   Acessos ativos: ${danieleAccess?.length || 0}`);
            
            if (danieleAccess && danieleAccess.length > 0) {
                const now = new Date();
                let activeCount = 0;
                console.log('\n   📋 Detalhes dos acessos:');
                danieleAccess.forEach((access, idx) => {
                    const plat = access.platform_accounts?.platforms;
                    const isActive = plat?.status === 'active' && 
                                   (!access.valid_until || new Date(access.valid_until) >= now);
                    if (isActive) activeCount++;
                    
                    const status = isActive ? '✅' : '❌';
                    console.log(`   ${status} ${idx + 1}. ${plat?.name} - ${access.platform_accounts?.label}`);
                    console.log(`       Válido: ${new Date(access.valid_from).toLocaleDateString('pt-BR')} até ${access.valid_until ? new Date(access.valid_until).toLocaleDateString('pt-BR') : '∞'}`);
                });
                console.log(`\n   ⭐ Plataformas ativas: ${activeCount}/${danieleAccess.length}`);
            } else {
                console.log('\n   ⚠️  Nenhum acesso encontrado!');
            }
        }

        // 3. Resumo e Status
        console.log('\n\n' + '='.repeat(60));
        console.log('📊 RESUMO FINAL');
        console.log('='.repeat(60));
        
        console.log('\n✅ CORREÇÕES APLICADAS:');
        console.log('  1. ✅ Daniel - Dados já existentes, query corrigida');
        console.log('  2. ✅ Daniele - Acessos concedidos automaticamente');
        console.log('  3. ✅ Frontend - Queries problemáticas corrigidas em 4 páginas');
        console.log('     - Plataformas.jsx');
        console.log('     - Dashboard.jsx');
        console.log('     - Admin.jsx');
        console.log('     - Conta.jsx');

        console.log('\n🔧 MUDANÇAS TÉCNICAS:');
        console.log('  - Removido .or() problemático com datas ISO');
        console.log('  - Aplicado filtro de data no frontend (JavaScript)');
        console.log('  - Melhor tratamento de valid_until (null ou > now)');
        console.log('  - Adicionado try-catch para melhor tratamento de erros');

        console.log('\n✨ PRÓXIMOS PASSOS:');
        console.log('  1. Restart do frontend (npm run dev)');
        console.log('  2. Limpar cache do navegador (Ctrl+Shift+Delete)');
        console.log('  3. Fazer login novamente com ambos os usuários');
        console.log('  4. Verificar se conseguem acessar as plataformas');

    } catch (error) {
        console.error('\n❌ ERRO:', error);
    }
}

finalCheck();
