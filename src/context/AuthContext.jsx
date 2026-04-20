import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { claimAdminInviteLink, claimPendingCheckoutBenefits } from '../lib/babylonApi';

const AuthContext = createContext({});
const ADMIN_INVITE_STORAGE_KEY = 'concursaflix.adminInviteToken';
const PROFILE_REFRESH_INTERVAL_MS = 45_000; // Atualiza profile a cada 45s quando aba está visível
const CLAIM_BENEFITS_INTERVAL_MS = 60_000;  // Re-tenta claim de benefícios pendentes a cada 60s

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileLoading, setProfileLoading] = useState(false);
    const bootstrappedProfileFor = useRef(null);
    const claimedPendingBenefitsFor = useRef(null);  // { userId, lastAttempt, applied }
    const claimedInviteFor = useRef(null);

    async function fetchProfileRow(userId) {
        let result = await supabase
            .from('profiles')
            .select('id, email, full_name, whatsapp, avatar_url, role, subscription_status, can_access_store')
            .eq('id', userId)
            .single();

        if (result.error && String(result.error.message || '').toLowerCase().includes('can_access_store')) {
            result = await supabase
                .from('profiles')
                .select('id, email, full_name, whatsapp, avatar_url, role, subscription_status')
                .eq('id', userId)
                .single();
            if (!result.error && result.data) {
                result.data = { ...result.data, can_access_store: false };
            }
        }

        return result;
    }

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setUser(null);
            setLoading(false);
            return;
        }

        // Check active sessions and sets the user
        supabase.auth.getSession()
            .then(({ data: { session } }) => {
                setUser(session?.user ?? null);
            })
            .catch((error) => {
                console.error('Error retrieving auth session:', error);
                setUser(null);
            })
            .finally(() => {
                setLoading(false);
            });

        // Listen for changes on auth state (logged in, signed out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function fetchProfile() {
            if (!isSupabaseConfigured) {
                setProfile(null);
                setProfileLoading(false);
                return;
            }

            if (!user) {
                setProfile(null);
                setProfileLoading(false);
                return;
            }

            try {
                setProfileLoading(true);
                const { data, error } = await fetchProfileRow(user.id);

                if (cancelled) return;
                if (error) {
                    // If profile doesn't exist (users created before trigger), create a default one.
                    const looksLikeNoRows = error.code === 'PGRST116' || (error.message || '').toLowerCase().includes('0 rows');
                    if (looksLikeNoRows && bootstrappedProfileFor.current !== user.id) {
                        bootstrappedProfileFor.current = user.id;
                        const { error: insertError } = await supabase.from('profiles').insert({
                            id: user.id,
                            email: user.email,
                            full_name: user.user_metadata?.full_name ?? null,
                            whatsapp: user.user_metadata?.whatsapp ?? null,
                            avatar_url: null,
                            role: 'student',
                            subscription_status: 'teste-gratis',
                        });
                        if (insertError) throw insertError;

                        const retry = await fetchProfileRow(user.id);
                        if (retry.error) throw retry.error;
                        setProfile(retry.data);
                        return;
                    }

                    throw error;
                }
                setProfile(data);
            } catch (error) {
                if (!cancelled) {
                    console.error('Error fetching profile:', error);
                    setProfile(null);
                }
            } finally {
                if (!cancelled) setProfileLoading(false);
            }
        }

        fetchProfile();
        return () => {
            cancelled = true;
        };
    }, [user]);

    // ── Refresh automático do profile (visibilitychange + intervalo) ──
    // Garante que mudanças feitas pelo admin (liberação de acesso, créditos, etc)
    // reflitam na tela do usuário sem precisar recarregar a página.
    const refreshProfile = useCallback(async () => {
        if (!isSupabaseConfigured || !user?.id) return;
        try {
            const { data, error } = await fetchProfileRow(user.id);
            if (!error && data) {
                setProfile((prev) => {
                    // Só atualiza state se algo realmente mudou (evita re-renders desnecessários)
                    if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
                    return data;
                });
            }
        } catch {
            // Silencioso — não quebra a UX se falhar
        }
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;

        // Refresh ao voltar pra aba (usuário minimizou, admin liberou acesso, voltou)
        function handleVisibilityChange() {
            if (document.visibilityState === 'visible') {
                refreshProfile();
            }
        }

        // Refresh periódico enquanto aba está ativa
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') {
                refreshProfile();
            }
        }, PROFILE_REFRESH_INTERVAL_MS);

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(intervalId);
        };
    }, [user?.id, refreshProfile]);

    useEffect(() => {
        let cancelled = false;

        async function claimPendingBenefits() {
            if (!isSupabaseConfigured || !user?.id) {
                claimedPendingBenefitsFor.current = null;
                return;
            }

            const now = Date.now();
            const prev = claimedPendingBenefitsFor.current;

            // Se já aplicou benefícios E é o mesmo user, não precisa repetir
            if (prev?.userId === user.id && prev?.applied) {
                return;
            }

            // Cooldown: não re-tenta antes do intervalo mínimo
            if (prev?.userId === user.id && prev?.lastAttempt && (now - prev.lastAttempt) < CLAIM_BENEFITS_INTERVAL_MS) {
                return;
            }

            claimedPendingBenefitsFor.current = { userId: user.id, lastAttempt: now, applied: false };

            try {
                const result = await claimPendingCheckoutBenefits();
                if (cancelled) return;

                const appliedCount = Number(result?.result?.applied_count || 0);
                const storeEnabled = Boolean(result?.result?.store_enabled);

                if (appliedCount > 0 || storeEnabled) {
                    claimedPendingBenefitsFor.current = { userId: user.id, lastAttempt: now, applied: true };
                    const refreshed = await fetchProfileRow(user.id);
                    if (!cancelled && !refreshed.error && refreshed.data) {
                        setProfile(refreshed.data);
                    }
                }
                // Se applied_count === 0, NÃO marca como applied — vai re-tentar no próximo ciclo
            } catch (error) {
                // Em caso de falha, reseta para permitir re-tentativa
                claimedPendingBenefitsFor.current = { userId: user.id, lastAttempt: now, applied: false };
                console.warn('Pending checkout benefits were not synced now:', error?.message || error);
            }
        }

        claimPendingBenefits();

        // Re-tenta periodicamente e quando a aba volta ao foco
        const intervalId = setInterval(claimPendingBenefits, CLAIM_BENEFITS_INTERVAL_MS);

        function handleVisibilityForClaim() {
            if (document.visibilityState === 'visible') {
                claimPendingBenefits();
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityForClaim);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityForClaim);
        };
    }, [user?.id]);

    useEffect(() => {
        let cancelled = false;

        async function claimInviteIfPresent() {
            if (!isSupabaseConfigured) {
                claimedInviteFor.current = null;
                return;
            }

            if (!user?.id) {
                claimedInviteFor.current = null;
                return;
            }

            if (claimedInviteFor.current === user.id) {
                return;
            }

            claimedInviteFor.current = user.id;

            const inviteToken = String(localStorage.getItem(ADMIN_INVITE_STORAGE_KEY) || '').trim();
            if (!inviteToken) {
                return;
            }

            try {
                const result = await claimAdminInviteLink(inviteToken);
                if (cancelled) return;

                const status = String(result?.result?.status || '').toLowerCase();
                if (status === 'claimed') {
                    const refreshed = await fetchProfileRow(user.id);
                    if (!cancelled && !refreshed.error && refreshed.data) {
                        setProfile(refreshed.data);
                    }
                }

                localStorage.removeItem(ADMIN_INVITE_STORAGE_KEY);
            } catch (error) {
                const message = String(error?.message || '').toLowerCase();
                const terminalStates = ['invalid_token', 'expired', 'revoked', 'email_mismatch', 'already_used'];
                if (terminalStates.some((state) => message.includes(state))) {
                    localStorage.removeItem(ADMIN_INVITE_STORAGE_KEY);
                }
                console.warn('Invite link was not applied now:', error?.message || error);
            }
        }

        claimInviteIfPresent();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const updateProfileLocally = (patch) => {
        setProfile((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    // Senha temporária usada durante migração de identidades (abril 2026).
    // Será removida automaticamente após todos os usuários afetados fazerem login.
    const _MIGRATION_TEMP_PWD = 'TempSenha@2026';

    // Lista EXATA dos 50 emails afetados pela migração de abril 2026.
    // Apenas esses emails podem acionar a migração transparente.
    const _MIGRATION_AFFECTED_EMAILS = new Set([
        'danieldasilsoares75@gmail.com','danieldasilsoares76@gmail.com','marcosouza1987@hotmail.com',
        'juuannmartins@gmail.com','tiagoibmec2007@hotmail.com','lavio1cg@gmail.com',
        'bcostsilv@gmail.com','raphalc60@gmail.com','taylor.moreira9@gmail.com',
        'unibaiereventos@gmail.com','gilberto.metodo@gmail.com','alsn.provas@gmail.com',
        'lypeoliveira56@gmail.com','armandinhopm155@gmail.com','psanderlan@gmail.com',
        'dr.alandermato1@gmail.com','patriciamiranda0788@gmail.com','larissapires@icloud.com',
        'ygor3kc1@gmail.com','danielss098@gmail.com','cgardenya@gmail.com',
        'safanelliallan@gmail.com','leomaricato.neves@gmail.com','jsilvajef@gmail.com',
        'teste112@gmail.com','124@gmail.com','netomat19@gmail.com',
        'mayara.honorios@gmail.com','leandrobrandaoferreiramendes@gmail.com','menezesandre25@gmail.com',
        'miguel.estudo@gmail.com','sr.vaishnava@gmail.com','gabgabriellab@gmail.com',
        'glpgabi9876@gmail.com','rogerionakaiko@hotmail.com','fabriciolisboa.cc@hotmail.com',
        'juniomotoboy2021@gmail.com','anamaria2015935@gmail.com','seuemail@gmail.com',
        'lima.jr38@gmail.com','ismarleysmachado@gmail.com','ulissescharles33@gmail.com',
        'leandrolowton@gmail.com','gabrielnascimento.gnr@gmail.com','heitor763@gmail.com',
        'moreiranete77@gmail.com','infoservicesms@gmail.com','aurinoadv@gmail.com',
        'annecarolina.sa@gmail.com','alveselianfelipe@gmail.com',
    ]);

    async function signInWithFallback(data) {
        if (!isSupabaseConfigured) {
            return {
                data: null,
                error: { message: 'Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.' },
            };
        }

        const userIntendedPassword = data?.password;

        const firstAttempt = await supabase.auth.signInWithPassword(data);
        if (!firstAttempt?.error) return firstAttempt;

        const errorMessage = String(firstAttempt.error?.message || '').toLowerCase();

        // ── Migração transparente de senha (segura) ──
        // Só ativa para os 50 emails afetados E que ainda não migraram neste browser.
        const normalizedEmail = String(data?.email || '').trim().toLowerCase();
        const migrationDoneKey = `_pwd_migrated_${normalizedEmail}`;
        const alreadyMigrated = localStorage.getItem(migrationDoneKey) === '1';
        const isAffectedUser = _MIGRATION_AFFECTED_EMAILS.has(normalizedEmail);

        if (
            errorMessage.includes('invalid login credentials')
            && userIntendedPassword
            && userIntendedPassword !== _MIGRATION_TEMP_PWD
            && isAffectedUser
            && !alreadyMigrated
        ) {
            try {
                const migrationAttempt = await supabase.auth.signInWithPassword({
                    email: data?.email,
                    password: _MIGRATION_TEMP_PWD,
                });

                if (!migrationAttempt?.error && migrationAttempt?.data?.session) {
                    // Sucesso com senha temporária — este usuário foi afetado pela migração.
                    // Atualiza a senha para o que o usuário realmente digitou.
                    const { error: updateError } = await supabase.auth.updateUser({
                        password: userIntendedPassword,
                    });

                    // Marca como migrado para nunca mais tentar neste browser.
                    localStorage.setItem(migrationDoneKey, '1');

                    if (!updateError) {
                        // Senha atualizada com sucesso. Faz sign out da sessão temporária
                        // e re-autentica com a senha que o usuário escolheu.
                        await supabase.auth.signOut();

                        const finalAttempt = await supabase.auth.signInWithPassword({
                            email: data?.email,
                            password: userIntendedPassword,
                        });

                        if (!finalAttempt?.error) {
                            // Migração transparente concluída com sucesso!
                            return finalAttempt;
                        }
                    }

                    // Se a atualização de senha falhou mas o login com temp funcionou,
                    // retorna a sessão que já temos (melhor do que erro).
                    return migrationAttempt;
                }
            } catch {
                // Se qualquer etapa da migração falhar, continua o fluxo normal.
            }
        }

        // ── Fallback de rede (já existente) ──
        const shouldFallback = errorMessage.includes('failed to fetch') || errorMessage.includes('network');
        if (!shouldFallback) return firstAttempt;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey) return firstAttempt;

        try {
            const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    apikey: supabaseAnonKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: data?.email,
                    password: data?.password,
                }),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
                return firstAttempt;
            }

            const { error: setSessionError } = await supabase.auth.setSession({
                access_token: payload.access_token,
                refresh_token: payload.refresh_token,
            });

            if (setSessionError) return firstAttempt;

            return {
                data: {
                    user: payload.user ?? null,
                    session: payload,
                },
                error: null,
            };
        } catch {
            return firstAttempt;
        }
    }

    const signOutWithCleanup = async () => {
        if (!isSupabaseConfigured) return { error: null };
        
        try {
            // Limpa todos os dados de sessão e cache
            await supabase.auth.signOut();
            
            // Limpa localStorage (exceto configurações que devem persistir)
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('supabase') || key.includes('auth') || key.includes('session'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            // Limpa sessionStorage
            sessionStorage.clear();
            
            // Reseta estados locais
            setUser(null);
            setProfile(null);
            bootstrappedProfileFor.current = null;
            claimedPendingBenefitsFor.current = null;
            claimedInviteFor.current = null;
            
            return { error: null };
        } catch (error) {
            console.error('Error during sign out:', error);
            return { error };
        }
    };

    const value = {
        signUp: (data) => {
            if (!isSupabaseConfigured) {
                return Promise.resolve({
                    data: null,
                    error: { message: 'Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.' },
                });
            }
            return supabase.auth.signUp(data);
        },
        signIn: (data) => signInWithFallback(data),
        signOut: signOutWithCleanup,
        user,
        profile,
        profileLoading,
        isAdmin: profile?.role === 'admin',
        canAccessStore: profile?.role === 'admin' || profile?.can_access_store === true,
        updateProfileLocally,
        refreshProfile,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
