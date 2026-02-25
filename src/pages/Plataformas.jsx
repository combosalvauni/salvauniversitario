import { useMemo, useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Download, Eye, Copy, Check, Lock, Loader2, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

function normalizeKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function isComboLikePlatform(platform) {
    const text = `${platform?.name || ''} ${platform?.description || ''}`.toLowerCase();
    return text.includes('combo') || text.includes('pacote') || text.includes('bundle');
}

export function Plataformas() {
    const { isAdmin, user } = useAuth();
    const [platforms, setPlatforms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPlatform, setSelectedPlatform] = useState(null);
    const [copied, setCopied] = useState(false);
    const [search, setSearch] = useState('');
    const [accessSet, setAccessSet] = useState(new Set());
    const [accessPriorityMap, setAccessPriorityMap] = useState(new Map());
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        fetchPlatforms();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, user?.id]);

    async function fetchPlatforms() {
        try {
            setLoading(true);
            setLoadError('');
            const { data, error } = await supabase
                .from('platforms_public')
                .select('*')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: false });

            if (error) throw error;

            const { data: comboProducts } = await supabase
                .from('store_products')
                .select('name, metadata, product_type')
                .eq('product_type', 'combo');

            const comboPlatformIds = new Set(
                (comboProducts || [])
                    .map((item) => item?.metadata?.platform_id)
                    .filter(Boolean)
            );

            const comboKeys = new Set(
                (comboProducts || [])
                    .map((item) => normalizeKey(item?.name))
                    .filter(Boolean)
            );

            const filtered = (data || []).filter((platform) => {
                if (platform?.is_visible === false) return false;
                if (comboPlatformIds.has(platform.id)) return false;
                if (isComboLikePlatform(platform)) return false;
                if (comboKeys.has(normalizeKey(platform?.name))) return false;
                return true;
            });

            setPlatforms(filtered);

            if (!isAdmin) {
                // RLS on platform_accounts only returns accounts assigned to this user and marked show_to_user
                const nowIso = new Date().toISOString();

                const [
                    { data: accounts, error: accountsError },
                    { data: assignments },
                ] = await Promise.all([
                    supabase
                        .from('platform_accounts')
                        .select('platform_id')
                        .eq('status', 'active'),
                    supabase
                        .from('platform_account_assignments')
                        .select('valid_from, created_at, platform_accounts!inner(platform_id, status)')
                        .eq('profile_id', user?.id)
                        .is('revoked_at', null)
                        .eq('show_to_user', true)
                        .lte('valid_from', nowIso)
                        .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
                        .eq('platform_accounts.status', 'active'),
                ]);

                if (!accountsError) {
                    setAccessSet(new Set((accounts || []).map((r) => r.platform_id)));

                    const priorityByPlatform = new Map();
                    for (const row of assignments || []) {
                        const platformId = row?.platform_accounts?.platform_id;
                        if (!platformId) continue;
                        const timeValue = Date.parse(row?.valid_from || row?.created_at || '');
                        if (!Number.isFinite(timeValue)) continue;
                        const prev = priorityByPlatform.get(platformId) || 0;
                        if (timeValue > prev) {
                            priorityByPlatform.set(platformId, timeValue);
                        }
                    }

                    setAccessPriorityMap(priorityByPlatform);
                }
            } else {
                setAccessSet(new Set());
                setAccessPriorityMap(new Map());
            }
        } catch (error) {
            console.error('Error fetching platforms:', error);
            setPlatforms([]);
            setLoadError(error?.message || 'Erro ao carregar plataformas');
        } finally {
            setLoading(false);
        }
    }

    const filteredPlatforms = useMemo(() => {
        const query = search.trim().toLowerCase();
        const base = !query
            ? platforms
            : platforms.filter((platform) => (platform.name || '').toLowerCase().includes(query));

        if (isAdmin) return base;

        return [...base].sort((a, b) => {
            const aHasAccess = accessSet.has(a.id);
            const bHasAccess = accessSet.has(b.id);

            if (aHasAccess !== bHasAccess) {
                return aHasAccess ? -1 : 1;
            }

            if (aHasAccess && bHasAccess) {
                const aPriority = accessPriorityMap.get(a.id) || 0;
                const bPriority = accessPriorityMap.get(b.id) || 0;
                if (aPriority !== bPriority) {
                    return bPriority - aPriority;
                }
            }

            return 0;
        });
    }, [platforms, search, isAdmin, accessSet, accessPriorityMap]);

    const canAccessPlatform = (platformId) => isAdmin || accessSet.has(platformId);

    async function openAccess(platform) {
        if (!platform) return;
        if (!canAccessPlatform(platform.id)) return;
        if (platform.status !== 'active') return;

        const { data: accounts, error } = await supabase
            .from('platform_accounts')
            .select('id, label, access_email, access_password, extension_link, status')
            .eq('platform_id', platform.id)
            .eq('status', 'active')
            .order('label', { ascending: true });

        if (error) {
            console.error('Error fetching platform accounts:', error);
            return;
        }

        setSelectedPlatform({
            id: platform.id,
            name: platform.name,
            platform_extension_link: platform.extension_link,
            open_link: (accounts || []).find((acc) => acc.extension_link)?.extension_link || platform.extension_link || '',
            accounts: accounts || [],
        });
    }

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="font-display text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">Plataformas</h1>
                <p className="text-gray-400">Acesse seus cursos e ferramentas de estudo.</p>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar curso pelo nome..."
                    className="pl-9"
                />
            </div>

            {loadError ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                    {loadError}
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredPlatforms.map((platform) => (
                    (() => {
                        const platformAvailable = platform.status === 'active';
                        const canViewAccess = platformAvailable && canAccessPlatform(platform.id);

                        return (
                    <Card key={platform.id} className="flex flex-col overflow-hidden">
                        <div className="p-4 pb-0">
                            <div className="w-full aspect-square rounded-xl bg-white/10 flex items-center justify-center overflow-hidden">
                                {platform.image_url ? (
                                    <img src={platform.image_url} alt={platform.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="font-display font-bold text-4xl sm:text-5xl text-gray-500">{platform.name.charAt(0)}</span>
                                )}
                            </div>
                        </div>

                        <CardHeader className="space-y-0 pb-4 pt-4">
                            <CardTitle className="text-base sm:text-lg leading-tight">{platform.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-2">
                                <span className={cn(
                                    "flex h-2 w-2 rounded-full",
                                    platform.status === 'active' ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500"
                                )} />
                                <span className={cn(
                                    "text-xs font-medium uppercase",
                                    platform.status === 'active' ? "text-green-500" : "text-red-500"
                                )}>
                                    {platform.status === 'active' ? 'Ativo' : 'Expirado'}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1">
                            <p className="text-xs sm:text-sm text-gray-400">{platform.description}</p>

                            {platform.show_account_badge && (
                                <div className="mt-4 inline-flex rounded-lg border border-primary/30 bg-transparent px-2.5 py-1 text-[10px] sm:text-xs text-primary">
                                    <span className="font-semibold text-primary">Contas:</span>&nbsp;
                                    {Number.isFinite(Number(platform.account_badge_count))
                                        ? Number(platform.account_badge_count)
                                        : (Number(platform.active_accounts_count) || 0)}
                                </div>
                            )}
                        </CardContent>
                        <CardFooter>
                            <Button
                                variant={canViewAccess ? 'primary' : 'ghost'}
                                className={cn(
                                    "w-full",
                                    !canViewAccess && "bg-white/5 text-gray-400 border border-white/10"
                                )}
                                disabled={!canViewAccess}
                                onClick={() => canViewAccess && openAccess(platform)}
                            >
                                {canViewAccess ? (
                                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                        Ver Acesso <Eye className="h-4 w-4" />
                                    </span>
                                ) : (
                                    <><Lock className="mr-2 h-4 w-4" /> Sem acesso</>
                                )}
                            </Button>
                        </CardFooter>
                    </Card>
                        );
                    })()
                ))}
            </div>

            {selectedPlatform && (
                <Modal
                    isOpen={!!selectedPlatform}
                    onClose={() => setSelectedPlatform(null)}
                    title={`Acesso: ${selectedPlatform.name}`}
                >
                    <div className="space-y-6">
                        {(selectedPlatform.accounts || []).length === 0 ? (
                            <div className="text-sm text-gray-400">Nenhuma conta disponível para este acesso.</div>
                        ) : (
                            <div className="space-y-6">
                                {(selectedPlatform.accounts || []).map((acc, idx) => (
                                    <div key={acc.id} className="space-y-4">
                                        {(selectedPlatform.accounts || []).length > 1 && (
                                            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                Conta {idx + 1}: {acc.label || '—'}
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">E-mail de Acesso</label>
                                            <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 pl-3 items-center">
                                                <code className="flex-1 font-mono text-sm text-white overflow-x-auto scrollbar-none">{acc.access_email || '—'}</code>
                                                <button
                                                    onClick={() => handleCopy(acc.access_email || '')}
                                                    className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
                                                    title="Copiar E-mail"
                                                    disabled={!acc.access_email}
                                                >
                                                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Senha</label>
                                            <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 pl-3 items-center">
                                                <code className="flex-1 font-mono text-sm text-white overflow-x-auto scrollbar-none">{acc.access_password || '—'}</code>
                                                <button
                                                    onClick={() => handleCopy(acc.access_password || '')}
                                                    className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
                                                    title="Copiar Senha"
                                                    disabled={!acc.access_password}
                                                >
                                                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>

                                    </div>
                                ))}

                                {!!selectedPlatform.open_link && (
                                    <div className="pt-4 border-t border-white/10">
                                        <Button
                                            className="w-full"
                                            variant="primary"
                                            onClick={() => window.open(selectedPlatform.open_link, '_blank')}
                                        >
                                            <Download className="mr-2 h-4 w-4" /> Acessar plataforma
                                        </Button>
                                        <p className="mt-2 text-center text-xs text-gray-500">
                                            Esse link é configurado pelo admin em Plataformas.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}

