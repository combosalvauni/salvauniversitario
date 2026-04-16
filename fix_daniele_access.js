/**
 * CORREÇÃO: Conceder acesso a Daniele Manhães
 * 
 * Problema: Daniele não tem nenhuma atribuição de plataforma
 * Solução: Atribuir plataformas similares às do Daniel
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function grantAccessToDaniele() {
    console.log('🔧 CORRIGINDO: Concedendo acesso a Daniele Manhães...\n');

    try {
        // 1. Buscar Daniele
        const { data: daniele, error: findError } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .eq('email', 'danieldasilsoares76@gmail.com')
            .single();

        if (findError || !daniele) {
            console.log('❌ Erro: Não encontrei Daniele');
            return;
        }

        console.log(`✅ Encontrada: ${daniele.full_name} (${daniele.email})`);

        // 2. Buscar as mesmas plataformas que Daniel tem acesso
        const { data: daniel, error: danielError } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', 'danieldasilsoares75@gmail.com')
            .single();

        if (!daniel) {
            console.log('❌ Erro: Não encontrei Daniel');
            return;
        }

        const { data: danielAccess, error: accessError } = await supabase
            .from('platform_account_assignments')
            .select('account_id, valid_from, valid_until')
            .eq('profile_id', daniel.id)
            .is('revoked_at', null)
            .eq('show_to_user', true);

        if (accessError || !danielAccess || danielAccess.length === 0) {
            console.log('❌ Erro: Não encontrei atribuições do Daniel');
            return;
        }

        console.log(`📋 Daniel tem ${danielAccess.length} plataforma(s) atribuída(s)`);

        // 3. Conceder as mesmas plataformas para Daniele
        const newAssignments = danielAccess.map(access => ({
            profile_id: daniele.id,
            account_id: access.account_id,
            valid_from: access.valid_from,
            valid_until: access.valid_until,
            show_to_user: true,
            display_order: 0,
            note: `Acesso concedido automaticamente - Corresponde ao acesso de daniel`
        }));

        console.log(`\n📤 Atribuindo ${newAssignments.length} plataforma(s) para Daniele...`);

        const { data: insertedAssignments, error: insertError } = await supabase
            .from('platform_account_assignments')
            .insert(newAssignments)
            .select();

        if (insertError) {
            console.log(`❌ Erro ao atribuir: ${insertError.message}`);
            return;
        }

        console.log(`✅ Sucesso! Atribuições criadas:`);
        insertedAssignments.forEach((assign, idx) => {
            console.log(`   ${idx + 1}. ID: ${assign.id}`);
            console.log(`      Valid: ${assign.valid_from} até ${assign.valid_until || 'indefinido'}`);
        });

        console.log('\n✨ DANIELE AGORA TEM ACESSO!');

    } catch (error) {
        console.error('❌ ERRO:', error);
    }
}

grantAccessToDaniele();
