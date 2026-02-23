import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const publicClient = createClient(supabaseUrl, supabaseAnonKey);
const adminClient = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    : null;

async function createAdmin() {
    const email = process.env.ADMIN_EMAIL || 'admin@concursaflix.com';
    const password = process.env.ADMIN_PASSWORD || 'admin_master_password';
    const name = process.env.ADMIN_NAME || 'Administrador Supremo';

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('❌ VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios no .env');
        return;
    }

    console.log(`Checking status for ${email}...`);

    // Try to login first with public client
    const { data: loginData, error: loginError } = await publicClient.auth.signInWithPassword({ email, password });

    if (loginData?.user) {
        console.log('✅ User ALREADY EXISTS and login worked!');
        console.log('User ID:', loginData.user.id);

        if (adminClient) {
            const { error: profileError } = await adminClient
                .from('profiles')
                .upsert({
                    id: loginData.user.id,
                    email,
                    full_name: name,
                    role: 'admin',
                    subscription_status: 'anual',
                }, { onConflict: 'id' });

            if (profileError) {
                console.warn('⚠️ Não foi possível garantir role admin no profile:', profileError.message);
            } else {
                console.log('✅ Perfil garantido como admin.');
            }
        }

        return;
    }

    if (loginError && loginError.message.includes('Invalid login credentials')) {
        console.log('Usuário pode existir com senha diferente, ou não existir.');
    }

    if (!adminClient) {
        console.log('');
        console.log('⚠️ SUPABASE_SERVICE_ROLE_KEY não encontrado.');
        console.log('Sem essa chave, não dá para resetar senha de usuário existente via script.');
        console.log('Adicione no .env: SUPABASE_SERVICE_ROLE_KEY=...');
        console.log('Depois rode novamente: node create_admin_user.js');
        return;
    }

    console.log('Usando service role para criar/resetar admin...');

    const usersResponse = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersResponse.error) {
        console.error('❌ Erro ao listar usuários:', usersResponse.error.message);
        return;
    }

    const existing = (usersResponse.data?.users || []).find(
        (u) => (u.email || '').toLowerCase() === email.toLowerCase()
    );

    let adminUserId = existing?.id;

    if (!existing) {
        const created = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: name,
            }
        });

        if (created.error) {
            console.error('❌ Erro ao criar admin:', created.error.message);
            return;
        }

        adminUserId = created.data.user?.id;
        console.log('✅ Admin criado no Auth.');
    } else {
        const updated = await adminClient.auth.admin.updateUserById(existing.id, {
            password,
            email_confirm: true,
            user_metadata: {
                ...(existing.user_metadata || {}),
                full_name: name,
            },
        });

        if (updated.error) {
            console.error('❌ Erro ao resetar senha do admin:', updated.error.message);
            return;
        }

        console.log('✅ Senha do admin resetada com sucesso.');
    }

    if (!adminUserId) {
        console.error('❌ Não foi possível obter o ID do admin.');
        return;
    }

    const { error: profileError } = await adminClient
        .from('profiles')
        .upsert({
            id: adminUserId,
            email,
            full_name: name,
            role: 'admin',
            subscription_status: 'anual',
        }, { onConflict: 'id' });

    if (profileError) {
        console.error('❌ Erro ao garantir profile admin:', profileError.message);
        return;
    }

    console.log('✅ Profile atualizado para role=admin.');
    console.log('---');
    console.log('Login admin pronto para uso:');
    console.log('Email:', email);
    console.log('Senha:', password);
}

createAdmin();
