import { User as UserIcon, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

function resolveAvatarUrl(value) {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(value);
    return data?.publicUrl || '';
}

export function Header({ title, onOpenMenu }) {
    const { user, profile } = useAuth();
    const displayName = profile?.full_name || user?.email || 'Usuário';
    const planLabel = profile?.subscription_status || '';
    const avatarUrl = resolveAvatarUrl(profile?.avatar_url || '');

    return (
        <header className="sticky top-0 z-30 flex h-16 md:h-20 w-full items-center justify-between border-b border-white/5 bg-[#111111] px-4 md:px-8 transition-all duration-300">

            {/* Page Title / Breadcrumbs */}
            <div className="flex items-center gap-3 min-w-0">
                <button
                    type="button"
                    className="md:hidden rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                    onClick={onOpenMenu}
                    aria-label="Abrir menu"
                >
                    <Menu className="h-6 w-6" />
                </button>

                <div className="flex flex-col min-w-0">
                    <h2 className="font-display text-lg md:text-2xl font-semibold tracking-wide text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)] truncate">
                        {title}
                    </h2>
                    <span className="text-[10px] md:text-xs text-gray-400 uppercase tracking-widest">Área do Aluno</span>
                </div>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-2 md:gap-6 flex-shrink-0">
                {/* User Profile */}
                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end">
                        <span className="text-sm font-bold text-white max-w-[160px] truncate">{displayName}</span>
                        {planLabel ? (
                            <span className="text-xs text-primary truncate max-w-[160px]">Plano {planLabel}</span>
                        ) : (
                            <span className="text-xs text-gray-500">&nbsp;</span>
                        )}
                    </div>
                    <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-orange-400 shadow-[0_0_10px_rgba(255,102,0,0.5)]">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="Avatar" className="h-full w-full rounded-full object-cover" />
                        ) : (
                            <UserIcon className="h-5 w-5 text-white" />
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
