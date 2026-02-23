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

function formatBRL(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

export function Dashboard() {
    const { user, profile, isAdmin, canAccessStore } = useAuth();
    const [loading, setLoading] = useState(true);
    const [supportUrl, setSupportUrl] = useState('https://wa.me/5516998859608');
    const [activePlatforms, setActivePlatforms] = useState([]);
    const [expiringList, setExpiringList] = useState([]);
    const [userAccesses, setUserAccesses] = useState([]);
    const [totalUsers, setTotalUsers] = useState(null);
    const [totalActiveAccounts, setTotalActiveAccounts] = useState(null);
    const [walletBalance, setWalletBalance] = useState(0);

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
                        setUserAccesses([]);
                    }
                } else {
                    const nowIso = new Date().toISOString();
                    const [{ data: assignmentsData }, { data: balanceData }] = await Promise.all([
                        supabase
                            .from('platform_account_assignments')
                            .select('id, valid_from, valid_until, revoked_at, platform_accounts!inner(platform_id, label, status, platforms(name))')
                            .eq('profile_id', user.id)
                            .is('revoked_at', null)
                            .eq('show_to_user', true)
                            .lte('valid_from', nowIso)
                            .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
                            .eq('platform_accounts.status', 'active'),
                        supabase
                            .from('wallet_balances')
                            .select('balance')
                            .eq('profile_id', user.id)
                            .maybeSingle(),
                    ]);

                    const validAccesses = (assignmentsData || []).sort((a, b) => {
                        const timeA = a?.valid_until ? new Date(a.valid_until).getTime() : Number.POSITIVE_INFINITY;
                        const timeB = b?.valid_until ? new Date(b.valid_until).getTime() : Number.POSITIVE_INFINITY;
                        return timeA - timeB;
                    });

                    const soon = validAccesses
                        .filter((row) => isSoon(row.valid_until))
                        .sort((a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime());

                    if (!cancelled) {
                        setExpiringList(soon.slice(0, 5));
                        setUserAccesses(validAccesses);
                        setWalletBalance(Number(balanceData?.balance || 0));
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

    const platformsWithoutAccounts = useMemo(
        () => activePlatforms.filter((platform) => Number(platform.active_accounts_count || 0) === 0).length,
        [activePlatforms]
    );

    const nextExpiringAccess = useMemo(() => {
        if (isAdmin) return null;
        return userAccesses.find((row) => !!row?.valid_until) || null;
    }, [userAccesses, isAdmin]);

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
            canAccessStore
                ? { label: 'Saldo da Carteira', value: formatBRL(walletBalance), icon: Shield, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' }
                : { label: 'Plano Atual', value: profile?.subscription_status || 'teste-gratis', icon: Shield, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
            { label: 'Acessos Ativos', value: userAccesses.length, icon: Layers, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
            { label: 'Próxima renovação', value: nextExpiringLabel, description: nextExpiringDate, icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
            { label: 'Vencem em 7 dias', value: expiringList.length, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
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
                            : `Você tem ${userAccesses.length} acesso(s) ativo(s). Abaixo você vê as datas de renovação de cada acesso.`}
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
                        {isAdmin ? 'Acessos que vencem nos próximos 7 dias' : 'Seus acessos e datas de renovação'}
                    </h3>
                    <p className="mb-4 text-xs text-gray-400">
                        Acompanhe abaixo as datas de término dos seus acessos.
                    </p>
                    {(isAdmin ? expiringList : userAccesses).length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
                            {isAdmin ? 'Nenhum acesso com vencimento próximo.' : 'Nenhum acesso ativo encontrado no momento.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {(isAdmin ? expiringList : userAccesses).map((row, index) => {
                                const platformName = row?.platform_accounts?.platforms?.name || 'Plataforma';
                                const accountLabel = row?.platform_accounts?.label || 'Conta';
                                return (
                                    <div key={row.id || index} className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/10">
                                        <div>
                                            <p className="font-semibold text-white">{platformName} • {accountLabel}</p>
                                            <p className="text-xs text-gray-400">Renovação / vencimento: {fmtDate(row.valid_until)}{row.valid_until ? ` (${expiryHint(row.valid_until)})` : ''}</p>
                                        </div>
                                        <span className="text-xs text-yellow-400 font-semibold uppercase">
                                            {isSoon(row.valid_until) ? 'Expiração próxima' : 'Ativo'}
                                        </span>
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
                                <p className="text-2xl font-bold text-green-400">{userAccesses.length}</p>
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
