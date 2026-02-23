import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';

const DEFAULT_PLANS = [
    {
        slug: 'teste-gratis',
        name: 'Teste Grátis',
        price_text: 'Grátis',
        period_text: '/3 dias',
        features: ['Acesso limitado', 'Conheça a plataforma', 'Suporte básico'],
        badge_text: '',
        is_highlight: false,
        is_active: true,
        sort_order: 10,
    },
    {
        slug: 'mensal',
        name: 'Plano Mensal',
        price_text: 'R$ 39,90',
        period_text: '/mês',
        features: ['Acesso a todas as plataformas premium', 'Suporte prioritário', 'Atualizações automáticas'],
        badge_text: '',
        is_highlight: false,
        is_active: true,
        sort_order: 20,
    },
    {
        slug: 'trimestral',
        name: 'Plano Trimestral',
        price_text: 'R$ 94,90',
        period_text: '/3 meses',
        features: ['Tudo do Plano Mensal', 'Economia de 21%', 'Acesso prioritário a novos cursos'],
        badge_text: 'Melhor',
        is_highlight: true,
        is_active: true,
        sort_order: 30,
    },
    {
        slug: 'semestral',
        name: 'Plano Semestral',
        price_text: 'R$ 159,90',
        period_text: '/6 meses',
        features: ['Streaming', 'Acesso a 10 IAs GPT professores + Afiliação', 'Tudo do Plano Trimestral'],
        badge_text: '',
        is_highlight: false,
        is_active: true,
        sort_order: 40,
    },
    {
        slug: 'anual',
        name: 'Plano Anual',
        price_text: 'R$ 297,90',
        period_text: '/1 ano',
        features: ['Tudo do Plano Semestral', 'Melhor custo-benefício anual', 'Suporte prioritário'],
        badge_text: '',
        is_highlight: false,
        is_active: true,
        sort_order: 50,
    },
];

function slugify(value) {
    return (value || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function toEditable(plan) {
    return {
        ...plan,
        features_text: Array.isArray(plan.features) ? plan.features.join('\n') : '',
    };
}

export function PlansSettingsPanel() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const sortedPlans = useMemo(
        () => [...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        [plans]
    );

    const fetchPlans = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('subscription_plans')
            .select('id, slug, name, price_text, period_text, features, badge_text, is_highlight, is_active, sort_order')
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });

        if (error) {
            alert('Erro ao carregar planos: ' + error.message);
            setPlans(DEFAULT_PLANS.map(toEditable));
        } else if (!data || data.length === 0) {
            setPlans(DEFAULT_PLANS.map(toEditable));
        } else {
            setPlans((data || []).map(toEditable));
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchPlans();
    }, [fetchPlans]);

    function updatePlan(index, patch) {
        setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    }

    function movePlan(index, direction) {
        setPlans((prev) => {
            const list = [...prev];
            const to = direction === 'up' ? index - 1 : index + 1;
            if (to < 0 || to >= list.length) return list;
            const tmp = list[index];
            list[index] = list[to];
            list[to] = tmp;
            return list.map((p, idx) => ({ ...p, sort_order: (idx + 1) * 10 }));
        });
    }

    function addPlan() {
        setPlans((prev) => [
            ...prev,
            {
                slug: `novo-plano-${prev.length + 1}`,
                name: 'Novo Plano',
                price_text: 'R$ 0,00',
                period_text: '/mês',
                features: [],
                features_text: '',
                badge_text: '',
                is_highlight: false,
                is_active: true,
                sort_order: (prev.length + 1) * 10,
            },
        ]);
    }

    async function savePlans() {
        setSaving(true);
        const normalized = sortedPlans
            .filter((plan) => (plan.name || '').trim())
            .map((plan, idx) => {
                const slug = slugify(plan.slug || plan.name) || `plano-${idx + 1}`;
                const features = (plan.features_text || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);

                return {
                    id: plan.id,
                    slug,
                    name: plan.name.trim(),
                    price_text: (plan.price_text || '').trim() || 'R$ 0,00',
                    period_text: (plan.period_text || '').trim() || null,
                    features,
                    badge_text: (plan.badge_text || '').trim() || null,
                    is_highlight: !!plan.is_highlight,
                    is_active: !!plan.is_active,
                    sort_order: (idx + 1) * 10,
                };
            });

        const { data: existingRows } = await supabase.from('subscription_plans').select('slug');
        const existingSlugs = new Set((existingRows || []).map((row) => row.slug));
        const incomingSlugs = new Set(normalized.map((plan) => plan.slug));
        const toDelete = [...existingSlugs].filter((slug) => !incomingSlugs.has(slug));

        if (toDelete.length > 0) {
            const { error: deleteError } = await supabase
                .from('subscription_plans')
                .delete()
                .in('slug', toDelete);
            if (deleteError) {
                setSaving(false);
                return alert('Erro ao remover planos: ' + deleteError.message);
            }
        }

        const { error } = await supabase
            .from('subscription_plans')
            .upsert(normalized, { onConflict: 'slug' });

        if (error) {
            alert('Erro ao salvar planos: ' + error.message);
        } else {
            alert('Planos salvos com sucesso.');
            await fetchPlans();
        }

        setSaving(false);
    }

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" /> Configuração de Planos
                </CardTitle>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={addPlan}>
                        <Plus className="h-4 w-4 mr-2" /> Novo plano
                    </Button>
                    <Button type="button" onClick={savePlans} disabled={saving || loading}>
                        {saving ? 'Salvando...' : 'Salvar planos'}
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                ) : (
                    <div className="space-y-4">
                        {sortedPlans.map((plan, index) => (
                            <div key={`${plan.slug}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                    <Input
                                        value={plan.name || ''}
                                        onChange={(e) => updatePlan(index, { name: e.target.value, slug: slugify(e.target.value) || plan.slug })}
                                        placeholder="Nome do plano"
                                    />
                                    <Input
                                        value={plan.price_text || ''}
                                        onChange={(e) => updatePlan(index, { price_text: e.target.value })}
                                        placeholder="Preço (ex: R$ 39,90)"
                                    />
                                    <Input
                                        value={plan.period_text || ''}
                                        onChange={(e) => updatePlan(index, { period_text: e.target.value })}
                                        placeholder="Período (ex: /mês)"
                                    />
                                    <Input
                                        value={plan.badge_text || ''}
                                        onChange={(e) => updatePlan(index, { badge_text: e.target.value })}
                                        placeholder="Badge (opcional)"
                                    />
                                </div>

                                <textarea
                                    className="flex min-h-[90px] w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-200"
                                    value={plan.features_text || ''}
                                    onChange={(e) => updatePlan(index, { features_text: e.target.value })}
                                    placeholder={'Benefícios (1 por linha)'}
                                />

                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-4">
                                        <label className="text-sm text-gray-300 flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={!!plan.is_active}
                                                onChange={(e) => updatePlan(index, { is_active: e.target.checked })}
                                            />
                                            Ativo
                                        </label>
                                        <label className="text-sm text-gray-300 flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={!!plan.is_highlight}
                                                onChange={(e) => updatePlan(index, { is_highlight: e.target.checked })}
                                            />
                                            Destacar plano
                                        </label>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button type="button" variant="ghost" className="h-9 px-3" onClick={() => movePlan(index, 'up')} disabled={index === 0}>↑</Button>
                                        <Button type="button" variant="ghost" className="h-9 px-3" onClick={() => movePlan(index, 'down')} disabled={index === sortedPlans.length - 1}>↓</Button>
                                        <Button
                                            type="button"
                                            variant="danger"
                                            className="h-9 px-3"
                                            onClick={() => setPlans((prev) => prev.filter((_, i) => i !== index))}
                                        >
                                            Remover
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
