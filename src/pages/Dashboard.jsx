import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Users, Clock, AlertTriangle, Loader2, Shield } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

function isSoon(iso, days = 7) {
    if (!iso) return false;
    const now = Date.now();
    const until = new Date(iso).getTime();
    const limit = now + days * 24 * 60 * 60 * 1000;
    return until > now && until <= limit;
}

function fmtDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleDateString('pt-BR');
}

function daysUntil(iso) {
    if (!iso) return null;
    const now = new Date();
    const target = new Date(iso);

    const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const diffMs = targetStart.getTime() - nowStart.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function expiryHint(iso) {
    const days = daysUntil(iso);
    if (days == null) return '';
    if (days <= 0) return 'vence hoje';
    if (days === 1) return 'vence amanhã';
    return `vence em ${days} dias`;
}

function formatRemainingTime(iso) {
    if (!iso) return '—';
    const diffMs = new Date(iso).getTime() - Date.now();
    if (diffMs <= 0) return 'expirado';

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
        return `${days} dia${days > 1 ? 's' : ''} e ${hours}h`;
    }

    if (hours > 0) {
        return `${hours}h e ${minutes}min`;
    }

    return `${minutes} min`;
}

export function Dashboard() {
    const { user, profile, isAdmin } = useAuth();
    const [loading, setLoading] = useState(true);
    const [supportUrl, setSupportUrl] = useState('https://wa.me/5516998859608');
    const [activePlatforms, setActivePlatforms] = useState([]);
    const [accessiblePlatformIds, setAccessiblePlatformIds] = useState(new Set());
    const [expiringList, setExpiringList] = useState([]);
    const [totalUsers, setTotalUsers] = useState(null);
    const [totalActiveAccounts, setTotalActiveAccounts] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function loadDashboard() {
            if (!user?.id) return;

            setLoading(true);
            try {
                const [{ data: platformsData }, { data: supportData }] = await Promise.all([
                    supabase
                        .from('platforms_public')
                        .select('id, name, status, active_accounts_count')
                        .eq('status', 'active')
                        .order('sort_order', { ascending: true }),
                    supabase
                        .from('support_settings')
                        .select('whatsapp_url')
                        .eq('id', true)
                        .maybeSingle(),
                ]);

                const active = platformsData || [];
                if (!cancelled) setActivePlatforms(active);
                if (!cancelled && supportData?.whatsapp_url) setSupportUrl(supportData.whatsapp_url);

                if (isAdmin) {
                    const [{ data: profilesData }, { data: accountsData }, { data: assignmentsData }] = await Promise.all([
                        supabase.from('profiles').select('id'),
                        supabase.from('platform_accounts').select('id').eq('status', 'active'),
                        supabase
                            .from('platform_account_assignments')
                            .select('id, valid_until, revoked_at, platform_accounts(label, platforms(name))')
                            .is('revoked_at', null),
                    ]);

                    const soon = (assignmentsData || [])
                        .filter((row) => isSoon(row.valid_until))
                        .sort((a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime());

                    if (!cancelled) {
                        setTotalUsers((profilesData || []).length);
                        setTotalActiveAccounts((accountsData || []).length);
                        setExpiringList(soon.slice(0, 5));
                        setAccessiblePlatformIds(new Set(active.map((p) => p.id)));
                    }
                } else {
                    const [{ data: accountAccess }, { data: assignmentsData }] = await Promise.all([
                        supabase.from('platform_accounts').select('platform_id').eq('status', 'active'),
                        supabase
                            .from('platform_account_assignments')
                            .select('id, valid_until, revoked_at, platform_accounts(label, platforms(name))')
                            .eq('profile_id', user.id)
                            .is('revoked_at', null),
                    ]);

                    const ids = new Set((accountAccess || []).map((row) => row.platform_id));
                    const soon = (assignmentsData || [])
                        .filter((row) => isSoon(row.valid_until))
                        .sort((a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime());

                    if (!cancelled) {
                        setAccessiblePlatformIds(ids);
                        setExpiringList(soon.slice(0, 5));
                    }
                }
            } catch (error) {
                console.error('Erro ao carregar dashboard:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        loadDashboard();

        return () => {
            cancelled = true;
        };
    }, [user?.id, isAdmin]);

    const accessibleCount = useMemo(() => {
        if (isAdmin) return activePlatforms.length;
        return activePlatforms.filter((platform) => accessiblePlatformIds.has(platform.id)).length;
    }, [activePlatforms, accessiblePlatformIds, isAdmin]);

    const blockedCount = useMemo(() => Math.max(activePlatforms.length - accessibleCount, 0), [activePlatforms.length, accessibleCount]);

    const platformsWithoutAccounts = useMemo(
        () => activePlatforms.filter((platform) => Number(platform.active_accounts_count || 0) === 0).length,
        [activePlatforms]
    );

    const nextExpiringAccess = useMemo(() => {
        if (isAdmin) return null;
        return expiringList[0] || null;
    }, [expiringList, isAdmin]);

    const nextExpiringLabel = useMemo(() => {
        if (!nextExpiringAccess?.valid_until) return 'Sem vencimento próximo';
        return formatRemainingTime(nextExpiringAccess.valid_until);
    }, [nextExpiringAccess]);

    const nextExpiringDate = useMemo(() => {
        if (!nextExpiringAccess?.valid_until) return '';
        return `Data final: ${fmtDate(nextExpiringAccess.valid_until)}`;
    }, [nextExpiringAccess]);

    const statCards = isAdmin
        ? [
            { label: 'Usuários Cadastrados', value: totalUsers ?? '—', icon: Users, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
            { label: 'Plataformas Ativas', value: activePlatforms.length, icon: Layers, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
            { label: 'Contas Ativas', value: totalActiveAccounts ?? '—', icon: Shield, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
            { label: 'Vencem nos próximos 7 dias', value: expiringList.length, icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
        ]
        : [
            { label: 'Plano Atual', value: profile?.subscription_status || 'teste-gratis', icon: Shield, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
            { label: 'Plataformas Disponíveis', value: accessibleCount, icon: Layers, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
            { label: 'Sem Acesso no Momento', value: blockedCount, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
            { label: 'Próximo vencimento', value: nextExpiringLabel, description: nextExpiringDate, icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
        ];

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 to-background p-8 md:p-10">
                <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-primary/20 blur-[80px]" />
                <div className="relative z-10">
                    <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-3">
                        {isAdmin ? 'Painel Operacional' : `Bem-vindo, ${profile?.full_name || 'Universitário'}`}
                    </h1>
                    <p className="text-gray-300 max-w-3xl">
                        {isAdmin
                            ? `Você tem ${platformsWithoutAccounts} plataforma(s) ativa(s) sem contas ativas e ${expiringList.length} acesso(s) vencendo nos próximos 7 dias.`
                            : `Você tem ${accessibleCount} plataforma(s) disponível(is) agora e ${expiringList.length} acesso(s) com vencimento próximo.`}
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link to="/plataformas" className="rounded-xl bg-primary px-6 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(255,102,0,0.35)] hover:bg-primary-hover transition-colors">
                            Ir para Plataformas
                        </Link>
                        <button
                            type="button"
                            onClick={() => window.open(supportUrl, '_blank', 'noopener,noreferrer')}
                            className="rounded-xl border border-primary/30 px-6 py-2.5 font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                            Falar com Suporte
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {statCards.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className={cn('rounded-2xl border bg-white/5 p-6 backdrop-blur-sm transition-transform hover:-translate-y-1 hover:bg-white/10', stat.border)}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-400">{stat.label}</p>
                                    <p className="mt-2 text-3xl font-bold text-white">{stat.value}</p>
                                    {stat.description ? <p className="mt-1 text-xs text-gray-500">{stat.description}</p> : null}
                                </div>
                                <div className={cn('rounded-xl p-3', stat.bg)}>
                                    <Icon className={cn('h-6 w-6', stat.color)} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur-sm">
                    <h3 className="font-display text-xl font-bold text-white mb-4">
                        {isAdmin ? 'Acessos que vencem nos próximos 7 dias' : 'Seus próximos vencimentos de acesso'}
                    </h3>
                    <p className="mb-4 text-xs text-gray-400">
                        Acompanhe abaixo as datas de término dos seus acessos.
                    </p>
                    {expiringList.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
                            Nenhum acesso com vencimento próximo.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {expiringList.map((row, index) => {
                                const platformName = row?.platform_accounts?.platforms?.name || 'Plataforma';
                                const accountLabel = row?.platform_accounts?.label || 'Conta';
                                return (
                                    <div key={row.id || index} className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/10">
                                        <div>
                                            <p className="font-semibold text-white">{platformName} • {accountLabel}</p>
                                            <p className="text-xs text-gray-400">Data final do acesso: {fmtDate(row.valid_until)} ({expiryHint(row.valid_until)})</p>
                                        </div>
                                        <span className="text-xs text-yellow-400 font-semibold uppercase">Expiração próxima</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur-sm">
                    <h3 className="font-display text-xl font-bold text-white mb-4">
                        {isAdmin ? 'Saúde das Plataformas' : 'Resumo de Acesso'}
                    </h3>
                    <div className="space-y-3">
                        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                            <p className="text-xs uppercase text-gray-400">Plataformas ativas</p>
                            <p className="text-2xl font-bold text-white">{activePlatforms.length}</p>
                        </div>

                        {!isAdmin && (
                            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                                <p className="text-xs uppercase text-gray-400">Com acesso liberado</p>
                                <p className="text-2xl font-bold text-green-400">{accessibleCount}</p>
                            </div>
                        )}

                        {isAdmin && (
                            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                                <p className="text-xs uppercase text-gray-400">Sem contas ativas</p>
                                <p className="text-2xl font-bold text-red-400">{platformsWithoutAccounts}</p>
                            </div>
                        )}

                        <Link to="/plataformas" className="inline-flex w-full items-center justify-center rounded-xl border border-primary/30 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors">
                            Abrir Plataformas
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
