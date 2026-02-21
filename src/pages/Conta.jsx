import { useEffect, useMemo, useRef, useState } from 'react';
import { User, CreditCard, Shield, Settings, Gift } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const DEFAULT_PLANS = [
    {
        slug: 'teste-gratis',
        name: 'Teste Grátis',
        price_text: 'Grátis',
        period_text: '/3 dias',
        features: ['Acesso limitado', 'Conheça a plataforma', 'Suporte básico'],
        badge_text: '',
        is_highlight: false,
    },
    {
        slug: 'mensal',
        name: 'Plano Mensal',
        price_text: 'R$ 39,90',
        period_text: '/mês',
        features: ['Acesso a todas as plataformas premium', 'Suporte prioritário', 'Atualizações automáticas'],
        badge_text: '',
        is_highlight: false,
    },
    {
        slug: 'trimestral',
        name: 'Plano Trimestral',
        price_text: 'R$ 94,90',
        period_text: '/3 meses',
        features: ['Tudo do Plano Mensal', 'Economia de 21%', 'Acesso prioritário a novos cursos'],
        badge_text: 'Melhor',
        is_highlight: true,
    },
    {
        slug: 'semestral',
        name: 'Plano Semestral',
        price_text: 'R$ 159,90',
        period_text: '/6 meses',
        features: ['Streaming', 'Acesso a 10 IAs GPT professores + Afiliação', 'Tudo do Plano Trimestral'],
        badge_text: '',
        is_highlight: false,
    },
    {
        slug: 'anual',
        name: 'Plano Anual',
        price_text: 'R$ 297,90',
        period_text: '/1 ano',
        features: ['Tudo do Plano Semestral', 'Melhor custo-benefício anual', 'Suporte prioritário'],
        badge_text: '',
        is_highlight: false,
    },
];

const DEFAULT_SUPPORT_URL = 'https://wa.me/5516998859608';

function normalizeSlug(value) {
    return (value || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function resolveAvatarUrl(value) {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(value);
    return data?.publicUrl || '';
}

export function Conta() {
    const { user, profile, updateProfileLocally } = useAuth();
    const [plans, setPlans] = useState(DEFAULT_PLANS);
    const [supportUrl, setSupportUrl] = useState(DEFAULT_SUPPORT_URL);
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarSaving, setAvatarSaving] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        setAvatarUrl(resolveAvatarUrl(profile?.avatar_url || ''));
    }, [profile?.avatar_url]);

    useEffect(() => {
        let cancelled = false;

        async function loadPlans() {
            const { data, error } = await supabase
                .from('subscription_plans')
                .select('slug, name, price_text, period_text, features, badge_text, is_highlight, is_active, sort_order')
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });

            if (!cancelled && !error && data?.length) {
                setPlans(data);
            }
        }

        async function loadSupport() {
            const { data, error } = await supabase
                .from('support_settings')
                .select('whatsapp_url')
                .eq('id', true)
                .maybeSingle();
            if (!cancelled && !error && data?.whatsapp_url) {
                setSupportUrl(data.whatsapp_url);
            }
        }

        loadPlans();
        loadSupport();

        return () => {
            cancelled = true;
        };
    }, []);

    const currentPlan = useMemo(() => {
        const planKey = normalizeSlug(profile?.subscription_status);
        return plans.find((plan) => normalizeSlug(plan.slug) === planKey) || null;
    }, [plans, profile?.subscription_status]);

    const availablePlans = useMemo(
        () => plans.filter((plan) => normalizeSlug(plan.slug) !== 'anual'),
        [plans]
    );

    async function handleAvatarFileChange(event) {
        const file = event.target.files?.[0];
        if (!file || !user?.id) return;

        if (!file.type.startsWith('image/')) {
            alert('Selecione um arquivo de imagem.');
            event.target.value = '';
            return;
        }

        const maxBytes = 2 * 1024 * 1024;
        if (file.size > maxBytes) {
            alert('A imagem deve ter no máximo 2MB.');
            event.target.value = '';
            return;
        }

        try {
            setAvatarSaving(true);

            const extension = (file.name?.split('.').pop() || 'jpg').toLowerCase();
            const filePath = `${user.id}/avatar-${Date.now()}.${extension}`;

            const currentAvatarPath = profile?.avatar_url || '';
            const isStoragePath = currentAvatarPath
                && !currentAvatarPath.startsWith('data:')
                && !currentAvatarPath.startsWith('http://')
                && !currentAvatarPath.startsWith('https://');

            const { error: uploadError } = await supabase
                .storage
                .from('avatars')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: true,
                    contentType: file.type,
                });

            if (uploadError) {
                alert('Erro ao enviar foto: ' + uploadError.message);
                return;
            }

            const { error } = await supabase
                .from('profiles')
                .update({ avatar_url: filePath })
                .eq('id', user.id);

            if (error) {
                alert('Erro ao salvar foto: ' + error.message);
                return;
            }

            if (isStoragePath && currentAvatarPath !== filePath) {
                await supabase.storage.from('avatars').remove([currentAvatarPath]);
            }

            const publicUrl = resolveAvatarUrl(filePath);
            setAvatarUrl(publicUrl);
            updateProfileLocally?.({ avatar_url: filePath });
            alert('Foto de perfil atualizada com sucesso.');
        } catch (error) {
            alert(error?.message || 'Erro ao processar imagem.');
        } finally {
            setAvatarSaving(false);
            event.target.value = '';
        }
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <div>
                <h1 className="font-display text-3xl font-bold text-white mb-2">Minha Conta</h1>
                <p className="text-gray-400">Gerencie suas informações pessoais e assinatura conforme os planos configurados no admin.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
                <div className="space-y-6">
                    <Card className="flex flex-col items-center text-center p-6 bg-white/5 border-white/10">
                        <div className="relative mb-4">
                            <div className="h-24 w-24 rounded-full bg-gradient-to-br from-primary to-orange-400 p-1">
                                <div className="h-full w-full rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt="Foto de perfil" className="h-full w-full rounded-full object-cover" />
                                    ) : (
                                        <User className="h-10 w-10 text-white" />
                                    )}
                                </div>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAvatarFileChange}
                            />
                            <button
                                type="button"
                                onClick={() => !avatarSaving && fileInputRef.current?.click()}
                                disabled={avatarSaving}
                                className="absolute bottom-0 right-0 rounded-full bg-white p-2 text-black shadow-lg hover:bg-gray-200 transition-colors disabled:opacity-60"
                                title={avatarSaving ? 'Salvando foto...' : 'Alterar foto'}
                            >
                                <Settings className="h-4 w-4" />
                            </button>
                        </div>
                        <h2 className="text-xl font-bold text-white">{profile?.full_name || 'Universitário'}</h2>
                        <p className="text-sm text-gray-400">{profile?.email || user?.email || '—'}</p>
                        <div className="mt-4 rounded-full bg-primary/20 px-4 py-1 text-xs font-medium text-primary border border-primary/20">
                            {profile?.subscription_status ? `Plano ${profile.subscription_status}` : 'Sem plano'}
                        </div>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="h-5 w-5 text-primary" /> Informações Pessoais
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-400">Nome Completo</label>
                                    <Input value={profile?.full_name || ''} readOnly />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-400">E-mail</label>
                                    <Input value={profile?.email || user?.email || ''} disabled className="opacity-50" />
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button disabled>Salvar Alterações</Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard className="h-5 w-5 text-primary" /> Assinatura
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
                                <div>
                                    <p className="font-bold text-white">{currentPlan?.name || 'Plano não identificado'}</p>
                                    <p className="text-sm text-gray-400">Renovação conforme o plano contratado.</p>
                                </div>
                                <span className="text-primary font-bold">
                                    {currentPlan ? `${currentPlan.price_text}${currentPlan.period_text || ''}` : (profile?.subscription_status || '—')}
                                </span>
                            </div>
                            <div className="flex gap-4">
                                <Button variant="outline" className="w-full" disabled>Gerenciar Assinatura</Button>
                                <Button variant="outline" className="w-full text-red-400 hover:text-red-500 hover:border-red-500/50 hover:bg-red-500/10" disabled>Cancelar Plano</Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard className="h-5 w-5 text-primary" /> Planos Disponíveis
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {availablePlans.map((plan) => (
                                <div key={plan.slug} className="p-4 rounded-lg border transition-all border-primary/20 hover:border-primary/50">
                                    <div className="flex items-start justify-between mb-2 gap-3">
                                        <div>
                                            <h4 className="font-bold text-white">{plan.name}</h4>
                                            <p className="text-sm text-gray-400">
                                                {plan.price_text}
                                                {plan.period_text ? <span className="text-xs">{plan.period_text}</span> : null}
                                            </p>
                                        </div>
                                        {(plan.badge_text || plan.is_highlight) ? (
                                            <span className="inline-flex items-center rounded-md border border-transparent bg-primary text-white px-2.5 py-0.5 text-xs font-semibold">
                                                <Gift className="w-3 h-3 mr-1" />
                                                {plan.badge_text || 'Destaque'}
                                            </span>
                                        ) : null}
                                    </div>

                                    <ul className="space-y-1 text-xs text-gray-400">
                                        {(plan.features || []).map((feature, idx) => (
                                            <li key={`${plan.slug}-feature-${idx}`} className="flex items-center gap-1">
                                                <span className="text-primary">•</span>
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}

                            <div className="pt-4 border-t border-primary/20">
                                <p className="text-xs text-gray-400 text-center mb-3">
                                    Entre em contato com o suporte para mais informações sobre os planos
                                </p>
                                <Button
                                    variant="outline"
                                    className="w-full border-primary/30 text-primary hover:bg-primary/10"
                                    onClick={() => window.open(supportUrl, '_blank', 'noopener,noreferrer')}
                                >
                                    Falar com Suporte
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Shield className="h-5 w-5 text-primary" /> Segurança
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-400">Nova Senha</label>
                                <Input type="password" placeholder="••••••••" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-400">Confirmar Nova Senha</label>
                                <Input type="password" placeholder="••••••••" />
                            </div>
                            <div className="flex justify-end">
                                <Button variant="outline">Atualizar Senha</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
