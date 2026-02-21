import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileLoading, setProfileLoading] = useState(false);
    const bootstrappedProfileFor = useRef(null);

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
        // Check active sessions and sets the user
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
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

    const updateProfileLocally = (patch) => {
        setProfile((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    const value = {
        signUp: (data) => supabase.auth.signUp(data),
        signIn: (data) => supabase.auth.signInWithPassword(data),
        signOut: () => supabase.auth.signOut(),
        user,
        profile,
        profileLoading,
        isAdmin: profile?.role === 'admin',
        canAccessStore: profile?.role === 'admin' || profile?.can_access_store === true,
        updateProfileLocally,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
