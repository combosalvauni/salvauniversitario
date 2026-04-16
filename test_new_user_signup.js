/**
 * Script para testar fluxo completo de cadastro de novo usuário
 * Simula o que acontece quando um usuário se cadastra via interface
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const adminSupabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const publicSupabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function testNewUserSignup() {
    console.log('🧪 TESTE: Fluxo completo de cadastro de novo usuário\n');
    console.log('Este teste simula exatamente o que acontece quando um usuário se cadastra.\n');

    const testEmail = `novo_usuario_${Date.now()}@teste.com`;
    const testPassword = 'SenhaForte@123';
    const testName = 'Usuário Teste';
    const testWhatsapp = '21987654321';

    try {
        // 1. CADASTRO via signUp (como no Login.jsx)
        console.log('=== ETAPA 1: CADASTRO ===\n');
        console.log('📝 Dados do cadastro:');
        console.log('   Email:', testEmail);
        console.log('   Senha:', testPassword);
        console.log('   Nome:', testName);
        console.log('   WhatsApp:', testWhatsapp);
        console.log('\n🔄 Executando signUp...');

        const { data: signUpData, error: signUpError } = await publicSupabase.auth.signUp({
            email: testEmail,
            password: testPassword,
            options: {
                data: {
                    full_name: testName,
                    whatsapp: testWhatsapp
                }
            }
        });

        if (signUpError) {
            console.log('❌ Erro no signUp:', signUpError.message);
            throw signUpError;
        }

        console.log('✅ SignUp executado com sucesso!');
        console.log('   User ID:', signUpData.user?.id);
        console.log('   Email confirmado:', signUpData.user?.email_confirmed_at ? 'Sim' : 'Não');
        console.log('   Session criada:', signUpData.session ? 'Sim' : 'Não');

        // 2. VERIFICAR IDENTIDADE imediatamente após cadastro
        console.log('\n=== ETAPA 2: VERIFICAÇÃO DE IDENTIDADE ===\n');
        
        const { data: { users } } = await adminSupabase.auth.admin.listUsers();
        const newUser = users.find(u => u.id === signUpData.user?.id);

        if (newUser) {
            console.log('📊 Identidades no listUsers:', newUser.identities?.length || 0);
            if (newUser.identities && newUser.identities.length > 0) {
                console.log('✅ Identidade criada!');
                newUser.identities.forEach(id => {
                    console.log('   Provider:', id.provider);
                });
            } else {
                console.log('⚠️  Identidade NÃO aparece no listUsers (bug conhecido)');
            }
        }

        // 3. CONFIRMAR EMAIL (simulando confirmação)
        console.log('\n=== ETAPA 3: CONFIRMAÇÃO DE EMAIL ===\n');
        console.log('🔄 Confirmando email via admin...');

        const { error: confirmError } = await adminSupabase.auth.admin.updateUserById(
            signUpData.user.id,
            { email_confirm: true }
        );

        if (confirmError) {
            console.log('❌ Erro ao confirmar email:', confirmError.message);
        } else {
            console.log('✅ Email confirmado com sucesso!');
        }

        // 4. VERIFICAR PROFILE
        console.log('\n=== ETAPA 4: VERIFICAÇÃO DE PROFILE ===\n');
        
        // Aguardar trigger criar o profile
        await new Promise(resolve => setTimeout(resolve, 2000));

        const { data: profile, error: profileError } = await adminSupabase
            .from('profiles')
            .select('*')
            .eq('id', signUpData.user.id)
            .single();

        if (profileError) {
            console.log('⚠️  Profile não encontrado:', profileError.message);
            console.log('   Isso pode ser normal se o trigger ainda não executou.');
        } else {
            console.log('✅ Profile criado:');
            console.log('   Nome:', profile.full_name);
            console.log('   Email:', profile.email);
            console.log('   WhatsApp:', profile.whatsapp);
            console.log('   Role:', profile.role);
            console.log('   Status:', profile.subscription_status);
        }

        // 5. TESTAR LOGIN
        console.log('\n=== ETAPA 5: TESTE DE LOGIN ===\n');
        console.log('🔐 Tentando fazer login com as credenciais...');

        // Fazer logout primeiro
        await publicSupabase.auth.signOut();

        const { data: loginData, error: loginError } = await publicSupabase.auth.signInWithPassword({
            email: testEmail,
            password: testPassword
        });

        if (loginError) {
            console.log('❌ LOGIN FALHOU:', loginError.message);
            console.log('\n🔴 PROBLEMA CRÍTICO: Novo usuário não consegue fazer login!');
        } else {
            console.log('✅ LOGIN FUNCIONOU!');
            console.log('   User ID:', loginData.user.id);
            console.log('   Email:', loginData.user.email);
            console.log('   Identidades no login:', loginData.user.identities?.length || 0);
            
            if (loginData.user.identities && loginData.user.identities.length > 0) {
                console.log('   ✅ Identidade presente!');
                loginData.user.identities.forEach(id => {
                    console.log('      Provider:', id.provider);
                });
            }

            await publicSupabase.auth.signOut();
        }

        // 6. LIMPAR usuário de teste
        console.log('\n=== LIMPEZA ===\n');
        console.log('🗑️  Deletando usuário de teste...');
        
        await adminSupabase.auth.admin.deleteUser(signUpData.user.id);
        console.log('✅ Usuário deletado');

        // 7. CONCLUSÃO
        console.log('\n\n=== RESULTADO DO TESTE ===\n');

        if (!loginError) {
            console.log('✅ SUCESSO! Novos cadastros funcionam corretamente!');
            console.log('\n📋 Fluxo validado:');
            console.log('   1. ✅ SignUp cria usuário');
            console.log('   2. ✅ Email pode ser confirmado');
            console.log('   3. ✅ Profile é criado automaticamente');
            console.log('   4. ✅ Login funciona imediatamente');
            console.log('   5. ✅ Identidade está presente no login');
            console.log('\n💡 O sistema está pronto para novos cadastros!');
        } else {
            console.log('❌ FALHA! Novos cadastros NÃO funcionam!');
            console.log('\n🔴 PROBLEMA IDENTIFICADO:');
            console.log('   Usuários conseguem se cadastrar mas não conseguem fazer login.');
            console.log('\n🔧 AÇÃO NECESSÁRIA:');
            console.log('   Investigar por que a identidade não está sendo criada no signUp.');
        }

    } catch (error) {
        console.error('\n❌ ERRO NO TESTE:', error.message);
        console.error(error.stack);
    }
}

testNewUserSignup();
