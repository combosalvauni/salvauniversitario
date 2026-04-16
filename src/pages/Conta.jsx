import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, CreditCard, Shield, Settings, Gift, Wallet, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';
import { checkCheckoutStatus, createBabylonTransaction, getActiveGateway } from '../lib/babylonApi';
import { supabase } from '../lib/supabase';
import { trackPurchase } from '../lib/pixel';

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
const FORBIDDEN_DB_TEXT_REGEX = /salva\s*universit[aá]rio/gi;

function normalizeSlug(value) {
    return (value || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function formatExpirationDate(value) {
    if (!value) return 'Sem vencimento';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Sem vencimento';
    return parsed.toLocaleDateString('pt-BR');
}

function formatBRLFromCredits(value) {
    const credits = Number(value || 0);
    if (!Number.isFinite(credits) || credits <= 0) return 'R$ 0,00';
    return credits.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

function formatCreditsAmount(value) {
    const amount = Math.max(0, Math.round(Number(value || 0)));
    const label = amount === 1 ? 'crédito' : 'créditos';
    return `${amount.toLocaleString('pt-BR')} ${label}`;
}

function resolveAvatarUrl(value) {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(value);
    return data?.publicUrl || '';
}

function sanitizeTextForDatabase(value) {
    if (typeof value !== 'string') return value;
    return value.replace(FORBIDDEN_DB_TEXT_REGEX, '').trim();
}

function sanitizePayloadForDatabase(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizePayloadForDatabase(item));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((acc, [key, item]) => {
            acc[key] = sanitizePayloadForDatabase(item);
            return acc;
        }, {});
    }

    return sanitizeTextForDatabase(value);
}

function buildCheckoutIdempotencyKey(profileId) {
    const randomToken = Math.random().toString(36).slice(2, 10);
    return `babylon_${profileId}_${Date.now()}_${randomToken}`;
}

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function generateValidCpf() {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (d.every((v) => v === d[0])) d[8] = (d[0] + 1) % 10;
    const calc = (digits, len) => {
        const sum = digits.reduce((s, n, i) => s + n * (len + 1 - i), 0);
        const rem = sum % 11;
        return rem < 2 ? 0 : 11 - rem;
    };
    d.push(calc(d, 9));
    d.push(calc(d, 10));
    return d.join('');
}

function buildBabylonCustomer(user) {
    const metadata = user?.user_metadata || {};
    const fullName = String(
        metadata?.full_name
        || metadata?.name
        || metadata?.nome
        || user?.email?.split('@')[0]
        || 'Cliente'
    ).trim();

    const email = String(user?.email || 'cliente@email.com').trim() || 'cliente@email.com';

    const phoneDigits = normalizeDigits(
        metadata?.phone
        || metadata?.telefone
        || metadata?.whatsapp
        || ''
    );

    const cpfDigits = normalizeDigits(
        metadata?.cpf
        || metadata?.document
        || metadata?.document_number
        || ''
    );

    return {
        name: fullName,
        email,
        phone: phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : '11999999999',
        document: {
            type: 'CPF',
            number: cpfDigits.length === 11 ? cpfDigits : generateValidCpf(),
        },
    };
}

function collectStringValues(value, bucket = [], depth = 0) {
    if (depth > 6 || value == null) return bucket;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) bucket.push(trimmed);
        return bucket;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => collectStringValues(item, bucket, depth + 1));
        return bucket;
    }

    if (typeof value === 'object') {
        Object.values(value).forEach((item) => collectStringValues(item, bucket, depth + 1));
    }

    return bucket;
}

function looksLikePixCode(value) {
    if (typeof value !== 'string') return false;
    const normalized = value.replace(/\s+/g, '');
    if (normalized.length < 40) return false;
    return normalized.startsWith('000201')
        || normalized.includes('BR.GOV.BCB.PIX')
        || normalized.includes('PIX');
}

function looksLikeQrImage(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return text.startsWith('data:image/')
        || /^https?:\/\//i.test(text) && /(qr|qrcode|pix)/i.test(text);
}

function looksLikePaymentLink(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return /^https?:\/\//i.test(text) && !looksLikeQrImage(text);
}

function resolveCheckoutArtifacts(responseData) {
    const allStrings = collectStringValues(responseData);

    const pixCopyPasteCode = allStrings.find((value) => looksLikePixCode(String(value)));
    const pixQrUrl = allStrings.find((value) => looksLikeQrImage(String(value))) || null;
    const checkoutUrl = allStrings.find((value) => looksLikePaymentLink(String(value))) || null;

    return {
        checkoutUrl,
        pixCopyPasteCode: pixCopyPasteCode ? String(pixCopyPasteCode).trim() : null,
        pixQrUrl,
    };
}

export function Conta() {
    const { user, profile, profileLoading, canAccessStore, updateProfileLocally } = useAuth();
    const [plans, setPlans] = useState(DEFAULT_PLANS);
    const [supportUrl, setSupportUrl] = useState(DEFAULT_SUPPORT_URL);
    const [walletBalance, setWalletBalance] = useState(0);
    const [walletLoaded, setWalletLoaded] = useState(false);
    const [availableAccesses, setAvailableAccesses] = useState([]);
    const [accessesLoaded, setAccessesLoaded] = useState(false);
    const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
    const [creditBuyTab, setCreditBuyTab] = useState('sugestoes');
    const [selectedTopupCredits, setSelectedTopupCredits] = useState(10);
    const [customTopupCredits, setCustomTopupCredits] = useState('10');
    const [topupLoading, setTopupLoading] = useState(false);
    const [topupNotice, setTopupNotice] = useState('');
    const [topupCheckoutSession, setTopupCheckoutSession] = useState(null);
    const [topupCopiedField, setTopupCopiedField] = useState('');
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

    useEffect(() => {
        let cancelled = false;

        async function loadStoreData() {
            if (!canAccessStore || !user?.id) {
                if (!cancelled) {
                    setWalletBalance(0);
                    setWalletLoaded(false);
                    setAvailableAccesses([]);
                    setAccessesLoaded(false);
                }
                return;
            }

            if (!cancelled) {
                setWalletLoaded(false);
                setAccessesLoaded(false);
            }

            const nowIso = new Date().toISOString();
            const [walletResult, accessResult] = await Promise.all([
                supabase
                    .from('wallet_balances')
                    .select('balance')
                    .eq('profile_id', user.id)
                    .maybeSingle(),
                supabase
                    .from('platform_account_assignments')
                    .select('valid_until, platform_accounts!inner(platform_id, status, platforms(name))')
                    .eq('profile_id', user.id)
                    .is('revoked_at', null)
                    .eq('show_to_user', true)
                    .eq('platform_accounts.status', 'active')
                    .lte('valid_from', nowIso),
            ]);

            if (cancelled) return;

            setWalletBalance(Math.max(0, Math.round(Number(walletResult?.data?.balance || 0))));
            setWalletLoaded(true);

            // Filtrar apenas atribuições que não venceram
            const now = new Date();
            const accessByName = new Map();
            for (const item of accessResult?.data || []) {
                // Verificar se não venceu
                if (item.valid_until && new Date(item.valid_until) < now) {
                    continue;
                }
                const name = item?.platform_accounts?.platforms?.name || '';
                if (!name) continue;

                const nextValidUntil = item?.valid_until || null;
                const previous = accessByName.get(name);

                if (!previous) {
                    accessByName.set(name, nextValidUntil);
                    continue;
                }

                if (previous == null) continue;
                if (nextValidUntil == null) {
                    accessByName.set(name, null);
                    continue;
                }

                const previousTime = Date.parse(previous);
                const nextTime = Date.parse(nextValidUntil);
                if (Number.isFinite(nextTime) && (!Number.isFinite(previousTime) || nextTime > previousTime)) {
                    accessByName.set(name, nextValidUntil);
                }
            }

            const entries = Array.from(accessByName.entries()).map(([name, validUntil]) => ({
                name,
                validUntil,
            }));
            setAvailableAccesses(entries);
            setAccessesLoaded(true);
        }

        loadStoreData();

        return () => {
            cancelled = true;
        };
    }, [canAccessStore, user?.id]);

    const refreshTopupStatus = useCallback(async () => {
        const checkoutOrderId = topupCheckoutSession?.orderId;
        if (!checkoutOrderId || !user?.id) return;

        try {
            const { data, error } = await supabase
                .from('checkout_orders')
                .select('status, metadata, provider_order_id')
                .eq('id', checkoutOrderId)
                .eq('profile_id', user.id)
                .maybeSingle();

            if (error || !data) {
                setTopupNotice('Não foi possível atualizar o status da recarga agora.');
                return;
            }

            const metadata = data?.metadata || {};
            setTopupCheckoutSession((previous) => {
                if (!previous) return previous;
                return {
                    ...previous,
                    status: String(data.status || previous.status || 'pending').toLowerCase(),
                    providerOrderId: data.provider_order_id || previous.providerOrderId || null,
                    pixCopyPasteCode: metadata?.pix_copy_paste_code || previous.pixCopyPasteCode || null,
                    checkoutUrl: metadata?.checkout_url || previous.checkoutUrl || null,
                    pixQrUrl: metadata?.pix_qr_url || previous.pixQrUrl || null,
                };
            });

            if (data.status === 'paid') {
                const { data: balanceData } = await supabase
                    .from('wallet_balances')
                    .select('balance')
                    .eq('profile_id', user.id)
                    .maybeSingle();

                setWalletBalance(Math.max(0, Math.round(Number(balanceData?.balance || 0))));
                setWalletLoaded(true);

                trackPurchase({
                    value: (topupCheckoutSession?.amountCents || 0) / 100,
                    contentName: `Recarga de ${topupCheckoutSession?.topupCredits || 0} créditos`,
                    transactionId: topupCheckoutSession?.providerOrderId,
                });

                setTopupNotice('Pagamento confirmado. Créditos adicionados à sua conta.');
                return;
            }

            if (data.status === 'failed') {
                setTopupNotice('Pagamento não aprovado. Gere uma nova recarga para tentar novamente.');
                return;
            }

            try {
                const gatewayPoll = await checkCheckoutStatus(checkoutOrderId);
                const pollStatus = String(gatewayPoll?.status || 'pending').toLowerCase();

                if (pollStatus === 'paid') {
                    setTopupCheckoutSession((previous) => {
                        if (!previous) return previous;
                        return {
                            ...previous,
                            status: 'paid',
                        };
                    });

                    const { data: balanceData } = await supabase
                        .from('wallet_balances')
                        .select('balance')
                        .eq('profile_id', user.id)
                        .maybeSingle();

                    setWalletBalance(Math.max(0, Math.round(Number(balanceData?.balance || 0))));
                    setWalletLoaded(true);

                    trackPurchase({
                        value: (topupCheckoutSession?.amountCents || 0) / 100,
                        contentName: `Recarga de ${topupCheckoutSession?.topupCredits || 0} créditos`,
                        transactionId: topupCheckoutSession?.providerOrderId,
                    });

                    setTopupNotice('Pagamento confirmado. Créditos adicionados à sua conta.');
                    return;
                }

                if (pollStatus === 'failed') {
                    setTopupCheckoutSession((previous) => {
                        if (!previous) return previous;
                        return {
                            ...previous,
                            status: 'failed',
                        };
                    });
                    setTopupNotice('Pagamento não aprovado. Gere uma nova recarga para tentar novamente.');
                    return;
                }
            } catch {
                // Mantém o polling pelo Supabase quando a checagem direta no gateway falhar.
            }

            setTopupNotice('Pagamento ainda pendente. Finalize o PIX enquanto validamos automaticamente.');
        } catch {
            setTopupNotice('Não foi possível atualizar o status da recarga agora.');
        }
    }, [topupCheckoutSession?.orderId, user?.id]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const checkoutOrderId = topupCheckoutSession?.orderId;
        const status = String(topupCheckoutSession?.status || 'pending').toLowerCase();

        if (!checkoutOrderId || ['paid', 'failed', 'canceled', 'cancelled'].includes(status)) {
            return undefined;
        }

        refreshTopupStatus();
        const intervalId = window.setInterval(() => {
            refreshTopupStatus();
        }, 5000);

        return () => window.clearInterval(intervalId);
    }, [topupCheckoutSession?.orderId, topupCheckoutSession?.status, refreshTopupStatus]);

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

    function resolveTopupCreditsAmount() {
        if (creditBuyTab === 'sugestoes') {
            return Math.max(10, Number(selectedTopupCredits || 0));
        }

        const parsed = Number.parseInt(customTopupCredits || '0', 10);
        return Math.max(10, Number.isFinite(parsed) ? parsed : 0);
    }

    async function copyTopupPixCode(code) {
        if (!code) return;
        setTopupCopiedField('');
        try {
            await navigator.clipboard.writeText(String(code));
            setTopupCopiedField('pix_code');
            setTopupNotice('Código PIX copiado para a área de transferência.');
        } catch {
            setTopupNotice('Não foi possível copiar o código PIX automaticamente.');
        }
    }

    async function copyTopupPaymentLink(url) {
        if (!url) return;
        setTopupCopiedField('');
        try {
            await navigator.clipboard.writeText(String(url));
            setTopupCopiedField('payment_link');
            setTopupNotice('Link de pagamento copiado para a área de transferência.');
        } catch {
            setTopupNotice('Não foi possível copiar o link de pagamento automaticamente.');
        }
    }

    async function handleTopupPixCheckoutClick() {
        if (!user?.id) return;

        const topupCredits = resolveTopupCreditsAmount();
        if (!Number.isFinite(topupCredits) || topupCredits < 10) {
            setTopupNotice('A recarga mínima é de 10 créditos.');
            return;
        }

        const topupAmountCents = topupCredits * 100;

        setTopupCopiedField('');
        setTopupLoading(true);
        try {
            const gateway = await getActiveGateway();
            const providerName = gateway === 'syncpay' ? 'syncpay' : gateway === 'amplopay' ? 'amplopay' : gateway === 'enkibank' ? 'enkibank' : 'banco_babylon';
            const idempotencyKey = buildCheckoutIdempotencyKey(user.id);
            const baseMetadata = sanitizePayloadForDatabase({
                source: 'wallet_topup',
                payment_provider: providerName,
                topup_credits: topupCredits,
                topup_amount_cents: topupAmountCents,
                items: [],
            });

            const { data: order, error: orderError } = await supabase
                .from('checkout_orders')
                .insert({
                    profile_id: user.id,
                    status: 'draft',
                    provider_name: providerName,
                    idempotency_key: idempotencyKey,
                    total_credit_cost: 0,
                    purchased_credit: topupCredits,
                    metadata: baseMetadata,
                })
                .select('id')
                .maybeSingle();

            if (orderError || !order?.id) {
                setTopupCheckoutSession(null);
                setTopupNotice('Não foi possível criar a recarga agora.');
                return;
            }

            let transactionResponse;
            try {
                transactionResponse = await createBabylonTransaction(sanitizePayloadForDatabase({
                    amount: topupAmountCents,
                    currency: 'BRL',
                    payment_method: 'PIX',
                    paymentMethod: 'PIX',
                    customer: buildBabylonCustomer(user),
                    items: [{
                        title: `Recarga de ${topupCredits} créditos`,
                        unitPrice: topupAmountCents,
                        quantity: 1,
                        externalRef: order.id,
                    }],
                    external_id: order.id,
                    externalRef: order.id,
                    idempotency_key: idempotencyKey,
                    description: `Recarga de créditos (${topupCredits})`,
                    metadata: {
                        checkout_order_id: order.id,
                        source: 'wallet_topup',
                        topup_credits: topupCredits,
                    },
                }));
            } catch (gatewayError) {
                await supabase
                    .from('checkout_orders')
                    .update({
                        status: 'failed',
                        metadata: sanitizePayloadForDatabase({
                            ...baseMetadata,
                            payment_error: sanitizeTextForDatabase(gatewayError?.message || 'gateway_error'),
                        }),
                    })
                    .eq('id', order.id);

                setTopupCheckoutSession(null);
                setTopupNotice(`Não foi possível iniciar a recarga PIX: ${gatewayError?.message || 'erro no gateway'}`);
                return;
            }

            const providerOrderId = transactionResponse?.provider_order_id
                || transactionResponse?.order_id
                || transactionResponse?.transaction_id
                || transactionResponse?.id
                || transactionResponse?.data?.id
                || null;

            const gatewayStatus = String(
                transactionResponse?.status
                || transactionResponse?.data?.status
                || 'pending'
            ).toLowerCase();

            const {
                checkoutUrl,
                pixCopyPasteCode,
                pixQrUrl,
            } = resolveCheckoutArtifacts(transactionResponse);

            const isGatewayFailure = ['refused', 'failed', 'canceled', 'cancelled', 'denied', 'error'].includes(gatewayStatus);

            await supabase
                .from('checkout_orders')
                .update({
                    status: isGatewayFailure ? 'failed' : 'pending',
                    provider_name: providerName,
                    provider_order_id: providerOrderId,
                    metadata: sanitizePayloadForDatabase({
                        ...baseMetadata,
                        gateway_order_id: providerOrderId,
                        gateway_status: gatewayStatus,
                        checkout_url: checkoutUrl,
                        pix_copy_paste_code: pixCopyPasteCode,
                        pix_qr_url: pixQrUrl,
                    }),
                })
                .eq('id', order.id);

            if (isGatewayFailure) {
                setTopupCheckoutSession(null);
                setTopupNotice(`Recarga recusada pelo gateway (status: ${gatewayStatus}).`);
                return;
            }

            setTopupCheckoutSession({
                orderId: order.id,
                providerOrderId,
                topupCredits,
                amountCents: topupAmountCents,
                status: gatewayStatus,
                checkoutUrl,
                pixCopyPasteCode,
                pixQrUrl,
            });

            if (pixCopyPasteCode) {
                await copyTopupPixCode(pixCopyPasteCode);
            } else {
                setTopupNotice('Recarga PIX criada. Finalize o pagamento no checkout abaixo.');
            }
        } finally {
            setTopupLoading(false);
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
                                <CreditCard className="h-5 w-5 text-primary" /> Assinatura
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {canAccessStore ? (
                                <div className="rounded-xl bg-white/5 p-4 border border-white/5">
                                    <p className="text-xs text-gray-400 mb-2">Acessos ativos:</p>
                                    {accessesLoaded && availableAccesses.length ? (
                                        <ul className="space-y-1 text-sm text-white">
                                            {availableAccesses.map((access) => (
                                                <li key={`${access.name}-${access.validUntil || 'sem-vencimento'}`} className="flex items-center justify-between gap-2">
                                                    <span className="flex items-center gap-2">
                                                        <span className="text-primary">•</span>
                                                        {access.name}
                                                    </span>
                                                    <span className="text-xs text-gray-400">
                                                        Vence em {formatExpirationDate(access.validUntil)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-400">
                                            {accessesLoaded ? 'Nenhum acesso ativo no momento.' : 'Carregando acessos...'}
                                        </p>
                                    )}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    {profileLoading ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <CreditCard className="h-5 w-5 text-primary" /> Carregando
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="rounded-xl bg-white/5 p-4 border border-white/5">
                                    <p className="text-sm text-gray-400">Atualizando informações da sua conta...</p>
                                </div>
                            </CardContent>
                        </Card>
                    ) : canAccessStore ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Wallet className="h-5 w-5 text-primary" /> Saldo da Conta
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
                                    <p className="font-bold text-white">Saldo</p>
                                    <span className="text-primary font-bold">
                                        {walletLoaded ? `${formatCreditsAmount(walletBalance)} (${formatBRLFromCredits(walletBalance)})` : '...'}
                                    </span>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full border-primary/30 text-primary hover:bg-primary/10"
                                    onClick={() => {
                                        setTopupNotice('');
                                        setTopupCheckoutSession(null);
                                        setTopupCopiedField('');
                                        setIsTopupModalOpen(true);
                                    }}
                                >
                                    Comprar créditos
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
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
                    )}

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

            <Modal
                isOpen={isTopupModalOpen}
                onClose={() => {
                    setIsTopupModalOpen(false);
                    setTopupCheckoutSession(null);
                    setTopupCopiedField('');
                }}
                title="Comprar Créditos (PIX)"
            >
                <div className="space-y-4">
                    {topupNotice ? (
                        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
                            {topupNotice}
                        </div>
                    ) : null}

                    {topupCheckoutSession ? (
                        (() => {
                            const fallbackQrUrl = topupCheckoutSession?.pixCopyPasteCode
                                ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(String(topupCheckoutSession.pixCopyPasteCode))}`
                                : null;
                            const pixQrDisplayUrl = topupCheckoutSession?.pixQrUrl || fallbackQrUrl;

                            return (
                                <div className="space-y-4">
                                    <div className="space-y-3 border-b border-white/10 pb-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-semibold text-white">Resumo da recarga</h3>
                                            <span className={topupCheckoutSession.status === 'paid' ? 'rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-300' : topupCheckoutSession.status === 'failed' ? 'rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300' : 'rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-semibold text-yellow-300'}>
                                                {topupCheckoutSession.status || 'pending'}
                                            </span>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-200">
                                            Recarga de <span className="font-semibold text-white">{Number(topupCheckoutSession?.topupCredits || 0)} créditos</span>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-white/10 pt-2">
                                            <span className="text-sm text-gray-300">Total</span>
                                            <span className="text-base font-semibold text-white">{formatBRLFromCredits(topupCheckoutSession?.topupCredits || 0)}</span>
                                        </div>
                                    </div>

                                    {topupCheckoutSession.status === 'paid' ? (
                                        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 flex items-center gap-2 text-green-300 text-sm">
                                            <CheckCircle2 className="h-4 w-4" /> Pagamento confirmado. Créditos disponíveis na sua conta.
                                        </div>
                                    ) : null}

                                    {pixQrDisplayUrl ? (
                                        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                                            <p className="text-xs text-gray-400">1) Escaneie o QR Code no app do banco</p>
                                            <div className="rounded-xl border border-white/10 bg-white/95 p-3 flex justify-center">
                                                <img src={pixQrDisplayUrl} alt="QR Code PIX" className="w-52 h-52 rounded-lg" />
                                            </div>
                                        </div>
                                    ) : null}

                                    {topupCheckoutSession.pixCopyPasteCode ? (
                                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                                            <p className="text-xs text-gray-400">2) PIX Copia e Cola</p>
                                            <textarea
                                                readOnly
                                                value={topupCheckoutSession.pixCopyPasteCode}
                                                onClick={() => copyTopupPixCode(topupCheckoutSession.pixCopyPasteCode)}
                                                className="w-full min-h-24 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-200 cursor-copy"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="w-full"
                                                onClick={() => copyTopupPixCode(topupCheckoutSession.pixCopyPasteCode)}
                                            >
                                                <Copy className="h-4 w-4 mr-2" /> Copiar código PIX
                                            </Button>
                                            {topupCopiedField === 'pix_code' ? (
                                                <p className="text-[11px] text-green-400">Código PIX copiado com sucesso.</p>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => {
                                            setTopupCheckoutSession(null);
                                            setTopupCopiedField('');
                                            setTopupNotice('');
                                        }}
                                    >
                                        Gerar nova recarga
                                    </Button>
                                </div>
                            );
                        })()
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setCreditBuyTab('sugestoes')}
                                    className={creditBuyTab === 'sugestoes'
                                        ? 'rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary'
                                        : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10'}
                                >
                                    Sugestões
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCreditBuyTab('personalizado')}
                                    className={creditBuyTab === 'personalizado'
                                        ? 'rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary'
                                        : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10'}
                                >
                                    Personalizado
                                </button>
                            </div>

                            {creditBuyTab === 'sugestoes' ? (
                                <div className="flex flex-wrap gap-2">
                                    {[10, 20, 50, 100, 200].map((credits) => (
                                        <button
                                            key={credits}
                                            type="button"
                                            onClick={() => setSelectedTopupCredits(credits)}
                                            className={selectedTopupCredits === credits
                                                ? 'rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary'
                                                : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10'}
                                        >
                                            {credits} créditos ({formatBRLFromCredits(credits)})
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Input
                                        type="number"
                                        min="10"
                                        step="1"
                                        value={customTopupCredits}
                                        onChange={(e) => setCustomTopupCredits(e.target.value)}
                                        placeholder="Mínimo 10 créditos"
                                    />
                                    <p className="text-xs text-gray-400">
                                        Mínimo de 10 créditos por recarga.
                                    </p>
                                </div>
                            )}

                            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-gray-300">
                                <p>
                                    Valor da recarga:{' '}
                                    <span className="font-semibold text-white">
                                        {resolveTopupCreditsAmount()} créditos ({formatBRLFromCredits(resolveTopupCreditsAmount())})
                                    </span>
                                </p>
                            </div>

                            <Button
                                type="button"
                                className="w-full"
                                onClick={handleTopupPixCheckoutClick}
                                isLoading={topupLoading}
                            >
                                Comprar créditos com PIX
                            </Button>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
}
