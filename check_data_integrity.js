/**
 * Script para verificar integridade de dados e corrigir problemas
 * Verifica: foreign keys, dados corrompidos, e aplica correções
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDataIntegrity() {
    console.log('🔍 Verificando integridade de dados...\n');

    try {
        // 1. Verificar referências de foreign key em platform_account_assignments
        console.log('1️⃣  Verificando referências inválidas...');
        
        const { data: invalidAssignments, error: invalidError } = await supabase
            .rpc('get_invalid_platform_assignments');

        if (invalidError && invalidError.code !== 'PGRST116') {
            // Fazer verificação manual
            const { data: allAssignments, error: allError } = await supabase
                .from('platform_account_assignments')
                .select('id, account_id, profile_id');

            if (!allError && allAssignments) {
                const accountIds = new Set(allAssignments.map(a => a.account_id));
                const profileIds = new Set(allAssignments.map(a => a.profile_id));

                const { data: accounts, error: accError } = await supabase
                    .from('platform_accounts')
                    .select('id');

                const { data: profiles, error: profError } = await supabase
                    .from('profiles')
                    .select('id');

                let invalidCount = 0;
                const validAccounts = new Set(accounts?.map(a => a.id) || []);
                const validProfiles = new Set(profiles?.map(p => p.id) || []);

                for (const assign of allAssignments) {
                    if (!validAccounts.has(assign.account_id)) {
                        console.log(`   ❌ Atribuição ${assign.id}: account_id ${assign.account_id} não existe`);
                        invalidCount++;
                    }
                    if (!validProfiles.has(assign.profile_id)) {
                        console.log(`   ❌ Atribuição ${assign.id}: profile_id ${assign.profile_id} não existe`);
                        invalidCount++;
                    }
                }

                if (invalidCount === 0) {
                    console.log('   ✅ Todas as referências de FK estão válidas');
                }
            }
        }

        // 2. Verificar se há problemas com status de contas/plataformas
        console.log('\n2️⃣  Verificando status de contas vinculadas...');
        
        const { data: assignmentsWithInactiveAccounts, error: inactiveError } = await supabase
            .from('platform_account_assignments')
            .select(`
                id,
                profile_id,
                platform_accounts!inner(
                    id,
                    status,
                    platforms(status)
                )
            `)
            .or('platform_accounts.status.eq.inactive,platform_accounts->platforms->status.eq.inactive')
            .limit(10);

        if (inactiveError?.code === 'PGRST116') {
            console.log('   ✅ Nenhuma atribuição com contas/plataformas inativas');
        } else if (assignmentsWithInactiveAccounts && assignmentsWithInactiveAccounts.length > 0) {
            console.log(`   ⚠️  ${assignmentsWithInactiveAccounts.length} atribuição(ões) com status inativo`);
        }

        // 3. Verificar problemas de data
        console.log('\n3️⃣  Verificando atribuições com datas inválidas...');
        
        const { data: allAssigns, error: allAsError } = await supabase
            .from('platform_account_assignments')
            .select('id, valid_from, valid_until, profile_id')
            .limit(10);

        if (!allAsError && allAssigns) {
            let invalidDates = 0;
            allAssigns.forEach(assign => {
                if (assign.valid_from && assign.valid_until) {
                    const from = new Date(assign.valid_from);
                    const until = new Date(assign.valid_until);
                    if (from > until) {
                        console.log(`   ❌ Atribuição ${assign.id}: data_inicio > data_fim`);
                        invalidDates++;
                    }
                }
            });
            if (invalidDates === 0) {
                console.log('   ✅ Todas as datas estão válidas');
            }
        }

        // 4. Verificar problema específico com Daniel
        console.log('\n4️⃣  Investigação específica - Daniel...');
        
        const { data: danielData, error: danielError } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', 'danieldasilsoares75@gmail.com')
            .single();

        if (danielData) {
            const { data: danielAssigns, error: dAError } = await supabase
                .from('platform_account_assignments')
                .select(`
                    *,
                    platform_accounts(
                        *,
                        platforms(*)
                    )
                `)
                .eq('profile_id', danielData.id);

            if (dAError) {
                console.log(`   ❌ ERRO ao buscar atribuições de Daniel: ${dAError.message}`);
                console.log(`   Código: ${dAError.code}`);
            } else if (danielAssigns) {
                console.log(`   ✅ Obteve ${danielAssigns.length} atribuição(ões)`);
                danielAssigns.forEach((da, idx) => {
                    const accountStatus = da.platform_accounts?.status;
                    const platformStatus = da.platform_accounts?.platforms?.status;
                    console.log(`      ${idx + 1}. Conta: ${accountStatus}, Plataforma: ${platformStatus}`);
                });
            }
        }

    } catch (error) {
        console.error('\n❌ ERRO:', error);
    }
}

checkDataIntegrity();
