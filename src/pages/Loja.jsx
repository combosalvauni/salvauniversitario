import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Wallet, Image as ImageIcon, Search, Copy, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { createBabylonTransaction, getActiveGateway, checkStoreCheckoutStatus } from '../lib/babylonApi';
import { trackAddToCart, trackInitiateCheckout, trackPurchase } from '../lib/pixel';

const FORBIDDEN_DB_TEXT_REGEX = /salva\s*universit[aá]rio/gi;
const CHECKOUT_SESSION_STORAGE_KEY = 'concursaflix.checkoutSession';

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
    const candidatesCheckoutUrl = [
        responseData?.checkout_url,
        responseData?.payment_url,
        responseData?.secure_url,
        responseData?.secureUrl,
        responseData?.paymentLink,
        responseData?.checkoutLink,
        responseData?.link,
        responseData?.pix?.url,
        responseData?.url,
        responseData?.data?.checkout_url,
        responseData?.data?.payment_url,
        responseData?.data?.secure_url,
        responseData?.data?.secureUrl,
        responseData?.data?.paymentLink,
        responseData?.data?.checkoutLink,
        responseData?.data?.link,
        responseData?.data?.pix?.url,
    ].filter(Boolean);

    const candidatesPixCode = [
        responseData?.pix?.qrcode,
        responseData?.data?.pix?.qrcode,
        responseData?.pix?.copyAndPaste,
        responseData?.pix?.copy_paste,
        responseData?.pix?.copyPaste,
        responseData?.pix?.payload,
        responseData?.pix?.emv,
        responseData?.pix?.code,
        responseData?.data?.pix?.copyAndPaste,
        responseData?.data?.pix?.copy_paste,
        responseData?.data?.pix?.copyPaste,
        responseData?.data?.pix?.payload,
        responseData?.data?.pix?.emv,
        responseData?.data?.pix?.code,
        responseData?.pixCopiaECola,
        responseData?.pix_code,
        responseData?.pixCode,
        responseData?.brCode,
        responseData?.br_code,
        responseData?.qrCodeText,
        responseData?.qr_code_text,
    ].filter(Boolean);

    const candidatesQr = [
        responseData?.pix?.qrCodeUrl,
        responseData?.pix?.qr_code_url,
        responseData?.pix?.qrCodeImage,
        responseData?.pix?.qr_code_image,
        responseData?.data?.pix?.qrCodeUrl,
        responseData?.data?.pix?.qr_code_url,
        responseData?.data?.pix?.qrCodeImage,
        responseData?.data?.pix?.qr_code_image,
    ].filter(Boolean);

    const allStrings = collectStringValues(responseData);

    const pixCopyPasteCode = [
        ...candidatesPixCode,
        ...allStrings,
    ].find((value) => looksLikePixCode(String(value)));

    const pixQrUrl = [
        ...candidatesQr,
        ...allStrings,
    ].find((value) => looksLikeQrImage(String(value))) || null;

    const checkoutUrl = [
        ...candidatesCheckoutUrl,
        ...allStrings,
    ].find((value) => looksLikePaymentLink(String(value))) || null;

    return {
        checkoutUrl,
        pixCopyPasteCode: pixCopyPasteCode ? String(pixCopyPasteCode).trim() : null,
        pixQrUrl,
    };
}

function normalizeSlug(value) {
    return (value || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeKey(value) {
    return normalizeSlug(value).replace(/-/g, '');
}

const STREAMING_NAME_HINTS = [
    'netflix', 'prime', 'amazonprime', 'disney', 'hbo', 'max', 'globoplay', 'globopay', 'youtube',
    'paramount', 'paramout', 'crunchyroll', 'espn', 'tnt', 'hulu', 'appletv', 'telecine', 'mubi',
];

function hasStreamingHint(value) {
    const key = normalizeKey(value);
    if (!key) return false;
    return STREAMING_NAME_HINTS.some((hint) => key.includes(hint));
}

function resolveStreamingFlag(storeProduct) {
    if (storeProduct?.metadata?.is_streaming === true) return true;
    if (storeProduct?.metadata?.is_streaming === false) return false;
    return hasStreamingHint(storeProduct?.name) || hasStreamingHint(storeProduct?.slug);
}

function resolveComboFlag(storeProduct) {
    if (!storeProduct) return false;
    if ((storeProduct.product_type || '') === 'combo') return true;
    if (storeProduct?.metadata?.is_combo === true) return true;
    return String(storeProduct?.name || '').toLowerCase().includes('combo')
        || String(storeProduct?.slug || '').toLowerCase().includes('combo');
}

const STATIC_MONTHLY_PRICE_CENTS_BY_PLATFORM = {
    proenem: 3790,
    promedicina: 4790,
    granconcurso: 2590,
    tecconcursosadv: 2490,
    focus: 2590,
    direcaoconcurso: 2790,
    ranipassos: 2490,
    gammaaithor: 2490,
    chatgptplus: 2990,
};

function resolveFallbackMonthlyCents(platformName) {
    const key = normalizeKey(platformName);

    if (STATIC_MONTHLY_PRICE_CENTS_BY_PLATFORM[key]) {
        return STATIC_MONTHLY_PRICE_CENTS_BY_PLATFORM[key];
    }

    const aliasMap = [
        { aliases: ['proenem', 'proenemmed'], cents: 3790 },
        { aliases: ['promedicina', 'promed'], cents: 4790 },
        { aliases: ['granconcurso', 'gran'], cents: 2590 },
        { aliases: ['tecconcursosadv', 'tecconcursos'], cents: 2490 },
        { aliases: ['focus'], cents: 2590 },
        { aliases: ['direcaoconcurso', 'direcao'], cents: 2790 },
        { aliases: ['ranipassos', 'rani'], cents: 2490 },
        { aliases: ['gammaaithor', 'gamma', 'aithor'], cents: 2490 },
        { aliases: ['chatgptplus', 'chatgpt'], cents: 2990 },
    ];

    const found = aliasMap.find((entry) => entry.aliases.some((alias) => key.includes(alias) || alias.includes(key)));
    return found?.cents || 0;
}

function formatBRLFromCents(cents) {
    const value = Number(cents || 0) / 100;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
}

function toMonthlyText(totalCents, months) {
    if (!months || months <= 0) return '—';
    const monthly = Math.round(Number(totalCents || 0) / months);
    return `${formatBRLFromCents(monthly)}/mês`;
}

function normalizeCycleLabel(value) {
    const key = normalizeKey(value);
    if (key.includes('mensal') || key === 'mes') return 'Mensal';
    if (key.includes('trimestral')) return 'Trimestral';
    if (key.includes('semestral')) return 'Semestral';
    if (key.includes('anual')) return 'Anual';
    return value || 'Plano';
}

function buildCyclesFromMetadata(plans) {
    if (!Array.isArray(plans) || !plans.length) return [];

    const cycles = plans
        .map((plan) => {
            const totalCents = Number(plan?.price_cents || 0);
            const cycleLabel = normalizeCycleLabel(plan?.cycle || 'Plano');
            const months = cycleLabel === 'Mensal'
                ? 1
                : cycleLabel === 'Trimestral'
                    ? 3
                    : cycleLabel === 'Semestral'
                        ? 6
                        : cycleLabel === 'Anual'
                            ? 12
                            : 1;

            if (totalCents <= 0) return null;

            return {
                cycle: cycleLabel,
                totalCents,
                monthlyText: toMonthlyText(totalCents, months),
                isBest: cycleLabel === 'Anual',
            };
        })
        .filter(Boolean);

    const order = ['Mensal', 'Trimestral', 'Semestral', 'Anual'];
    return cycles.sort((a, b) => order.indexOf(a.cycle) - order.indexOf(b.cycle));
}

function getCycleMonths(cycleLabel) {
    if (cycleLabel === 'Mensal') return 1;
    if (cycleLabel === 'Trimestral') return 3;
    if (cycleLabel === 'Semestral') return 6;
    if (cycleLabel === 'Anual') return 12;
    return 1;
}

function calculateCycleOffPercent(cycle, monthlyBaseCents) {
    const months = getCycleMonths(cycle?.cycle);
    const total = Number(cycle?.totalCents || 0);
    const monthly = Number(monthlyBaseCents || 0);

    if (!months || monthly <= 0 || total <= 0 || cycle?.cycle === 'Mensal') return 0;

    const reference = monthly * months;
    if (reference <= 0 || total >= reference) return 0;

    return Math.round(((reference - total) / reference) * 100);
}

function applyMonthlyAccessComboPromotion(centsTotal, units) {
    const total = Number(centsTotal || 0);
    const count = Number(units || 0);
    if (total <= 0 || count <= 1) return total;

    const promotionalByUnits = {
        2: 4790,
        3: 5490,
        4: 6990,
    };

    const promotional = promotionalByUnits[count];
    if (!promotional || promotional <= 0) return total;

    return Math.min(total, promotional);
}

function cycleLabelToStorageValue(cycleLabel) {
    const value = normalizeCycleLabel(cycleLabel);
    return String(value || 'Mensal').toLowerCase();
}

function resolveOfferCycles(product) {
    const allowMonthly = product?.metadata?.allow_monthly !== false;
    const cyclesFromMetadata = buildCyclesFromMetadata(product?.offer_plans);

    if (cyclesFromMetadata.length) {
        let cycles = allowMonthly
            ? [...cyclesFromMetadata]
            : cyclesFromMetadata.filter((cycle) => cycle.cycle !== 'Mensal');

        const hasMonthly = cycles.some((cycle) => cycle.cycle === 'Mensal');
        if (allowMonthly && !hasMonthly && Number(product?.price_monthly_cents || 0) > 0) {
            cycles = [
                {
                    cycle: 'Mensal',
                    totalCents: Number(product.price_monthly_cents),
                    monthlyText: toMonthlyText(Number(product.price_monthly_cents), 1),
                    isBest: false,
                },
                ...cycles,
            ];
        }

        return cycles;
    }

    if (allowMonthly && Number(product?.price_monthly_cents || 0) > 0) {
        return [{
            cycle: 'Mensal',
            totalCents: Number(product.price_monthly_cents),
            monthlyText: toMonthlyText(Number(product.price_monthly_cents), 1),
            isBest: false,
        }];
    }

    return [];
}

function getCartEntryQuantity(entry) {
    if (typeof entry === 'number') return Number(entry || 0);
    return Number(entry?.quantity || 0);
}

function getCartEntrySelectedCycle(entry) {
    if (!entry || typeof entry === 'number') return null;
    return entry.selectedCycle || null;
}

function creditsFromCents(value) {
    const cents = Number(value || 0);
    if (!Number.isFinite(cents) || cents <= 0) return 0;
    return Math.ceil(cents / 100);
}

function formatBRLFromCredits(value) {
    const credits = Number(value || 0);
    if (!Number.isFinite(credits) || credits <= 0) return 'R$ 0,00';
    return (credits).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

export function Loja() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [walletBalance, setWalletBalance] = useState(0);
    const [walletLoaded, setWalletLoaded] = useState(false);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [catalogTab, setCatalogTab] = useState('todos');
    const [cartMap, setCartMap] = useState({});
    const [storeNotice, setStoreNotice] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [paymentChecking, setPaymentChecking] = useState(false);
    const [checkoutSession, setCheckoutSession] = useState(null);
    const [lastCopiedField, setLastCopiedField] = useState('');
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [selectedOfferCycle, setSelectedOfferCycle] = useState(null);
    const [isPaymentMethodModalOpen, setIsPaymentMethodModalOpen] = useState(false);
    const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
    const [creditBuyTab, setCreditBuyTab] = useState('sugestoes');
    const [selectedTopupCredits, setSelectedTopupCredits] = useState(10);
    const [customTopupCredits, setCustomTopupCredits] = useState('10');

    const copyPixCode = useCallback(async (code) => {
        if (!code) return;
        setLastCopiedField('');
        try {
            await navigator.clipboard.writeText(String(code));
            setLastCopiedField('pix_code');
            setStoreNotice('Código PIX copiado para a área de transferência.');
        } catch {
            setStoreNotice('Não foi possível copiar o código PIX automaticamente.');
        }
    }, []);

    const copyPaymentLink = useCallback(async (link) => {
        if (!link) return;
        setLastCopiedField('');
        try {
            await navigator.clipboard.writeText(String(link));
            setLastCopiedField('payment_link');
            setStoreNotice('Link de pagamento copiado. Cole no navegador ou no app do banco.');
        } catch {
            setStoreNotice('Não foi possível copiar o link de pagamento.');
        }
    }, []);

    const refreshCheckoutStatus = useCallback(async () => {
        const checkoutOrderId = checkoutSession?.orderId;
        if (!checkoutOrderId || !user?.id) return;

        setPaymentChecking(true);
        try {
            const { data, error } = await supabase
                .from('checkout_orders')
                .select('status, metadata, provider_order_id')
                .eq('id', checkoutOrderId)
                .eq('profile_id', user.id)
                .maybeSingle();

            if (error || !data) {
                setStoreNotice('Não foi possível atualizar o status do pagamento agora.');
                return;
            }

            const metadata = data?.metadata || {};
            setCheckoutSession((previous) => ({
                ...previous,
                status: String(data.status || previous?.status || 'pending').toLowerCase(),
                providerOrderId: data.provider_order_id || previous?.providerOrderId || null,
                pixCopyPasteCode: metadata?.pix_copy_paste_code || previous?.pixCopyPasteCode || null,
                checkoutUrl: metadata?.checkout_url || previous?.checkoutUrl || null,
                pixQrUrl: metadata?.pix_qr_url || previous?.pixQrUrl || null,
                accessItems: Array.isArray(metadata?.items)
                    ? metadata.items.map((item) => ({
                        name: item?.name || item?.item_name || 'Acesso',
                        quantity: Number(item?.quantity || 1),
                        cycle: item?.selected_cycle || item?.cycle || 'Mensal',
                    }))
                    : (previous?.accessItems || []),
            }));

            if (data.status === 'paid') {
                const { data: balanceData } = await supabase
                    .from('wallet_balances')
                    .select('balance')
                    .eq('profile_id', user.id)
                    .maybeSingle();

                if (balanceData) {
                    setWalletBalance(Number(balanceData.balance || 0));
                }

                const cs = checkoutSession;
                if (cs?.kind === 'topup') {
                    trackPurchase({
                        value: (cs.amountCents || 0) / 100,
                        contentName: `Recarga de ${cs.topupCredits || 0} créditos`,
                        transactionId: cs.providerOrderId,
                    });
                } else {
                    trackPurchase({
                        value: (cs?.amountCents || 0) / 100,
                        numItems: cs?.accessItems?.length,
                        contentName: (cs?.accessItems || []).map((i) => i.name).join(', ') || 'Loja',
                        transactionId: cs?.providerOrderId,
                    });
                }

                setStoreNotice('Pagamento confirmado. Acesso liberado nas suas plataformas.');
                return;
            }

            if (data.status === 'failed') {
                setStoreNotice('Pagamento não aprovado. Gere um novo checkout para tentar novamente.');
                return;
            }

            // Order still pending — poll the gateway directly via the server
            try {
                const gatewayPoll = await checkStoreCheckoutStatus(checkoutOrderId);
                const pollStatus = String(gatewayPoll?.status || 'pending').toLowerCase();

                if (pollStatus === 'paid') {
                    setCheckoutSession((previous) => ({
                        ...previous,
                        status: 'paid',
                    }));

                    const { data: balanceData } = await supabase
                        .from('wallet_balances')
                        .select('balance')
                        .eq('profile_id', user.id)
                        .maybeSingle();

                    if (balanceData) {
                        setWalletBalance(Number(balanceData.balance || 0));
                    }

                    const cs2 = checkoutSession;
                    if (cs2?.kind === 'topup') {
                        trackPurchase({
                            value: (cs2.amountCents || 0) / 100,
                            contentName: `Recarga de ${cs2.topupCredits || 0} créditos`,
                            transactionId: cs2.providerOrderId,
                        });
                    } else {
                        trackPurchase({
                            value: (cs2?.amountCents || 0) / 100,
                            numItems: cs2?.accessItems?.length,
                            contentName: (cs2?.accessItems || []).map((i) => i.name).join(', ') || 'Loja',
                            transactionId: cs2?.providerOrderId,
                        });
                    }

                    setStoreNotice('Pagamento confirmado. Acesso liberado nas suas plataformas.');
                    return;
                }

                if (pollStatus === 'failed') {
                    setCheckoutSession((previous) => ({
                        ...previous,
                        status: 'failed',
                    }));
                    setStoreNotice('Pagamento não aprovado. Gere um novo checkout para tentar novamente.');
                    return;
                }
            } catch {
                // Server-side poll failed — not critical, keep polling from Supabase
            }

            setStoreNotice('Pagamento ainda pendente. Finalize o PIX enquanto validamos automaticamente.');
        } finally {
            setPaymentChecking(false);
        }
    }, [checkoutSession?.orderId, user?.id]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.sessionStorage.getItem(CHECKOUT_SESSION_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;

            const status = String(parsed?.status || 'pending').toLowerCase();
            if (!parsed?.orderId || status === 'paid' || status === 'failed' || status === 'canceled' || status === 'cancelled') {
                window.sessionStorage.removeItem(CHECKOUT_SESSION_STORAGE_KEY);
                return;
            }

            setCheckoutSession(parsed);
            setStoreNotice('Checkout PIX restaurado. Continue o pagamento para liberar seu acesso.');
        } catch {
            window.sessionStorage.removeItem(CHECKOUT_SESSION_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!checkoutSession?.orderId) {
            window.sessionStorage.removeItem(CHECKOUT_SESSION_STORAGE_KEY);
            return;
        }

        const status = String(checkoutSession?.status || 'pending').toLowerCase();
        if (status === 'paid' || status === 'failed' || status === 'canceled' || status === 'cancelled') {
            window.sessionStorage.removeItem(CHECKOUT_SESSION_STORAGE_KEY);
            return;
        }

        window.sessionStorage.setItem(CHECKOUT_SESSION_STORAGE_KEY, JSON.stringify(checkoutSession));
    }, [checkoutSession]);

    useEffect(() => {
        const status = String(checkoutSession?.status || '').toLowerCase();
        if (!checkoutSession?.orderId || status === 'paid' || status === 'failed' || status === 'canceled' || status === 'cancelled') {
            return undefined;
        }

        const beforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', beforeUnload);
        return () => {
            window.removeEventListener('beforeunload', beforeUnload);
        };
    }, [checkoutSession?.orderId, checkoutSession?.status]);

    useEffect(() => {
        if (!checkoutSession?.orderId) return;

        const currentStatus = String(checkoutSession?.status || 'pending').toLowerCase();
        if (currentStatus === 'paid' || currentStatus === 'failed' || currentStatus === 'canceled' || currentStatus === 'cancelled') {
            return;
        }

        refreshCheckoutStatus();

        const intervalId = window.setInterval(() => {
            refreshCheckoutStatus();
        }, 5000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [checkoutSession?.orderId, checkoutSession?.status, user?.id, refreshCheckoutStatus]);

    useEffect(() => {
        if (!checkoutSession?.orderId || !checkoutSession?.pixCopyPasteCode) return;
        if (lastCopiedField === 'pix_code') return;
        copyPixCode(checkoutSession.pixCopyPasteCode);
    }, [checkoutSession?.orderId, checkoutSession?.pixCopyPasteCode, lastCopiedField, copyPixCode]);

    useEffect(() => {
        let cancelled = false;

        async function loadStoreAndWallet() {
            if (!user?.id) return;

            const cartQueryWithMetadata = supabase
                .from('store_cart_items')
                .select('product_id, quantity, metadata')
                .eq('profile_id', user.id);

            const cartQueryWithoutMetadata = supabase
                .from('store_cart_items')
                .select('product_id, quantity')
                .eq('profile_id', user.id);

            const [
                { data: balanceData, error: balanceError },
                { data: platformsData, error: platformsError },
                { data: productsData, error: productsError },
                { data: cartData, error: cartError },
            ] = await Promise.all([
                supabase
                    .from('wallet_balances')
                    .select('balance')
                    .eq('profile_id', user.id)
                    .maybeSingle(),
                supabase
                    .from('platforms_public')
                    .select('id, name, description, image_url, status, sort_order, created_at')
                    .eq('status', 'active')
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: false }),
                supabase
                    .from('store_products')
                    .select('id, slug, name, description, credit_cost, product_type, allow_multiple_units, is_highlight, metadata')
                    .eq('is_active', true)
                    .eq('is_visible', true)
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: true }),
                cartQueryWithMetadata,
            ]);

            if (cancelled) return;

            let finalCartData = cartData;
            let finalCartError = cartError;

            if (cartError && String(cartError.message || '').toLowerCase().includes('metadata')) {
                const fallbackCartResult = await cartQueryWithoutMetadata;
                finalCartData = fallbackCartResult.data;
                finalCartError = fallbackCartResult.error;
            }

            if (!balanceError && balanceData) {
                setWalletBalance(Number(balanceData.balance || 0));
            }

            const safeStoreProducts = productsData || [];
            const safePlatforms = platformsData || [];

            const mappedPlatformProducts = safePlatforms.map((platform) => {
                const platformSlug = normalizeSlug(platform.name);
                const platformKey = normalizeKey(platform.name);
                const fallbackMonthlyCents = Number(resolveFallbackMonthlyCents(platform.name) || 0);
                const candidateProducts = safeStoreProducts.filter((product) => {
                    const metadataPlatformId = product?.metadata?.platform_id;
                    const productType = String(product?.product_type || 'acesso').toLowerCase();
                    const productSlug = normalizeSlug(product.slug);
                    const productNameSlug = normalizeSlug(product.name);
                    const productKey = normalizeKey(product.slug || product.name);
                    if (metadataPlatformId === platform.id) return true;
                    if (productType !== 'acesso') return false;

                    return productSlug === platformSlug
                        || productSlug === platformSlug
                        || productNameSlug === platformSlug
                    || productKey === platformKey
                    || productKey.includes(platformKey)
                    || platformKey.includes(productKey);
                });

                const linkedStoreProduct = [...candidateProducts]
                    .sort((a, b) => {
                        const score = (product) => {
                            const metadataPlatformId = product?.metadata?.platform_id;
                            const productType = String(product?.product_type || 'acesso').toLowerCase();
                            const productSlug = normalizeSlug(product?.slug || '');
                            const productNameSlug = normalizeSlug(product?.name || '');
                            const productKey = normalizeKey(product?.slug || product?.name || '');
                            const hasPlans = Array.isArray(product?.metadata?.plans) && product.metadata.plans.some((plan) => Number(plan?.price_cents || 0) > 0);
                            const hasMonthly = Number(product?.metadata?.price_monthly_cents || 0) > 0;

                            let points = 0;
                            if (hasPlans) points += 2500;
                            if (metadataPlatformId === platform.id) points += 1000;
                            if (productType === 'acesso') points += 100;
                            if (hasMonthly) points += 300;
                            if (productSlug === platformSlug || productNameSlug === platformSlug) points += 20;
                            if (productKey === platformKey) points += 15;
                            if (productKey.includes(platformKey) || platformKey.includes(productKey)) points += 10;
                            points += Number(product?.sort_order ?? 0) / 10000;
                            return points;
                        };

                        return score(b) - score(a);
                    })
                    .at(0);

                if (!linkedStoreProduct) return null;

                return {
                    id: platform.id,
                    platform_id: platform.id,
                    sort_order: Number(linkedStoreProduct?.sort_order ?? 9999),
                    slug: platformSlug,
                    name: platform.name,
                    description: linkedStoreProduct?.description || platform.description || 'Acesso da plataforma.',
                    image_url: platform.image_url,
                    credit_cost: Number(linkedStoreProduct?.credit_cost || 0),
                    price_monthly_cents: Number(linkedStoreProduct?.metadata?.price_monthly_cents || fallbackMonthlyCents),
                    offer_plans: linkedStoreProduct?.metadata?.plans || [],
                    product_type: linkedStoreProduct?.product_type || 'acesso',
                    is_combo: resolveComboFlag(linkedStoreProduct),
                    allow_multiple_units: linkedStoreProduct?.allow_multiple_units ?? true,
                    is_highlight: linkedStoreProduct?.is_highlight || false,
                    is_streaming: resolveStreamingFlag(linkedStoreProduct),
                    store_product_id: linkedStoreProduct?.id || null,
                    has_defined_price: Boolean(
                        Number(linkedStoreProduct?.credit_cost || 0) > 0
                        || Number(linkedStoreProduct?.metadata?.price_monthly_cents || 0) > 0
                        || fallbackMonthlyCents > 0
                    ),
                };
            }).filter(Boolean);

            const mappedProducts = [...mappedPlatformProducts]
                .sort((a, b) => Number(a?.sort_order ?? 9999) - Number(b?.sort_order ?? 9999));

            if (!safePlatforms.length && safeStoreProducts.length) {
                const fallbackProducts = safeStoreProducts
                    .map((product) => ({
                        id: product.id,
                        platform_id: product?.metadata?.platform_id || null,
                        sort_order: Number(product?.sort_order ?? 9999),
                        slug: product.slug,
                        name: product.name,
                        description: product.description || 'Acesso interno',
                        image_url: '',
                        credit_cost: Number(product.credit_cost || 0),
                        price_monthly_cents: Number(product?.metadata?.price_monthly_cents || 0),
                        offer_plans: product?.metadata?.plans || [],
                        product_type: product.product_type || 'acesso',
                        is_combo: resolveComboFlag(product),
                        allow_multiple_units: product.allow_multiple_units ?? true,
                        is_highlight: product.is_highlight || false,
                        is_streaming: resolveStreamingFlag(product),
                        store_product_id: product.id,
                        has_defined_price: Number(product.credit_cost || 0) > 0 || Number(product?.metadata?.price_monthly_cents || 0) > 0,
                    }))
                    .sort((a, b) => Number(a?.sort_order ?? 9999) - Number(b?.sort_order ?? 9999));

                setProducts(fallbackProducts);
            } else {
                setProducts(mappedProducts);
            }

            const productsToUse = safePlatforms.length ? mappedProducts : safeStoreProducts.map((product) => ({
                id: product.id,
                store_product_id: product.id,
            }));

            if (!finalCartError && finalCartData?.length) {
                const nextCart = {};
                finalCartData.forEach((item) => {
                    const qty = Number(item.quantity || 0);
                    if (qty <= 0) return;

                    const matched = productsToUse.find((product) => product.store_product_id === item.product_id || product.id === item.product_id);
                    if (matched) {
                        const storedCycle = normalizeCycleLabel(item?.metadata?.selected_cycle || item?.metadata?.selectedCycle || '');
                        nextCart[matched.id] = {
                            quantity: qty,
                            selectedCycle: storedCycle && storedCycle !== 'Plano' ? storedCycle : null,
                        };
                    }
                });
                setCartMap(nextCart);
            }

            if (platformsError) {
                setStoreNotice('Não foi possível carregar plataformas agora.');
            } else if (!safePlatforms.length) {
                setStoreNotice('Nenhuma plataforma ativa disponível no momento.');
            } else if (!mappedProducts.length) {
                setStoreNotice('Nenhum produto disponível na loja no momento.');
            } else if (productsError || mappedProducts.some((item) => !item.has_defined_price)) {
                setStoreNotice('Valores de créditos ainda estão em configuração. Você já pode montar o carrinho e depois definimos preços oficiais.');
            } else {
                setStoreNotice('');
            }

            setWalletLoaded(true);
        }

        loadStoreAndWallet();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const cartItems = useMemo(() => products
        .map((product) => {
            const entry = cartMap[product.id];
            const quantity = getCartEntryQuantity(entry);
            if (quantity <= 0) return null;

            const cycles = resolveOfferCycles(product);
            const selectedCycle = getCartEntrySelectedCycle(entry);
            const selectedCycleData = cycles.find((cycle) => cycle.cycle === selectedCycle) || null;
            const selectedCycleLabel = selectedCycleData?.cycle || 'Mensal';
            const selectedTotalCents = Number(selectedCycleData?.totalCents || product.price_monthly_cents || 0);
            const selectedCycleMonths = getCycleMonths(selectedCycleLabel);
            const selectedMonthlyEquivalentCents = selectedCycleData
                ? Math.round(selectedTotalCents / Math.max(selectedCycleMonths, 1))
                : Number(product.price_monthly_cents || 0);
            const selectedCredits = creditsFromCents(selectedTotalCents);

            return {
                ...product,
                quantity,
                selectedCycle: selectedCycleData?.cycle || null,
                selectedCycleMonths,
                selectedPlanTotalCents: selectedTotalCents,
                selectedMonthlyEquivalentCents,
                subtotal: selectedCredits * quantity,
                subtotalPlanTotalCents: selectedTotalCents * quantity,
                subtotalMonthlyCents: selectedMonthlyEquivalentCents * quantity,
            };
        })
        .filter(Boolean), [products, cartMap]);

    const monthlyAccessPromoSummary = useMemo(() => {
        const eligibleItems = cartItems.filter((item) => {
            const selectedCycle = item.selectedCycle || 'Mensal';
            return selectedCycle === 'Mensal'
                && String(item.product_type || 'acesso').toLowerCase() === 'acesso'
                && !item.is_combo;
        });

        const units = eligibleItems.reduce((total, item) => total + Number(item.quantity || 0), 0);
        const regularCents = eligibleItems.reduce((total, item) => total + Number(item.subtotalMonthlyCents || 0), 0);
        const discountedCents = applyMonthlyAccessComboPromotion(regularCents, units);

        return {
            units,
            regularCents,
            discountedCents,
            discountCents: Math.max(regularCents - discountedCents, 0),
        };
    }, [cartItems]);

    const cartTotalMonthlyCents = useMemo(
        () => {
            const regularTotal = cartItems.reduce((total, item) => total + item.subtotalMonthlyCents, 0);
            if (monthlyAccessPromoSummary.discountCents <= 0) return regularTotal;
            return regularTotal - monthlyAccessPromoSummary.discountCents;
        },
        [cartItems, monthlyAccessPromoSummary]
    );

    const cartTotalPlanCents = useMemo(
        () => cartItems.reduce((total, item) => total + item.subtotalPlanTotalCents, 0),
        [cartItems]
    );

    const cartTotalPayableCents = useMemo(
        () => Math.max(Number(cartTotalPlanCents || 0) - Number(monthlyAccessPromoSummary.discountCents || 0), 0),
        [cartTotalPlanCents, monthlyAccessPromoSummary.discountCents]
    );

    const cartTotalPayableCredits = useMemo(
        () => creditsFromCents(cartTotalPayableCents),
        [cartTotalPayableCents]
    );

    const cartUnits = useMemo(
        () => cartItems.reduce((total, item) => total + item.quantity, 0),
        [cartItems]
    );

    const hasPendingPrices = useMemo(
        () => cartItems.some((item) => {
            const planTotal = Number(item.selectedPlanTotalCents || 0);
            const monthlyValue = Number(item.selectedMonthlyEquivalentCents || 0);
            return !item.has_defined_price || (planTotal <= 0 && monthlyValue <= 0);
        }),
        [cartItems]
    );

    const filteredProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        const byTab = products.filter((item) => {
            if (catalogTab === 'todos') {
                return !!item.platform_id && !item.is_combo;
            }
            if (catalogTab === 'streaming') {
                return item.is_streaming === true;
            }
            return true;
        });

        if (!query) return byTab;
        return byTab.filter((item) =>
            (item.name || '').toLowerCase().includes(query)
            || (item.description || '').toLowerCase().includes(query)
        );
    }, [products, search, catalogTab]);

    function openOfferDetails(product) {
        const cycles = resolveOfferCycles(product);
        const currentEntry = cartMap[product.id];
        const currentCycle = getCartEntrySelectedCycle(currentEntry);
        const hasCurrentCycle = cycles.some((cycle) => cycle.cycle === currentCycle);

        setSelectedOffer({
            product,
            title: product.name,
            subtitle: 'Escolha o ciclo ideal para finalizar com o melhor custo-benefício.',
            highlight: `Plano do acesso selecionado: ${product.name}`,
            cycles,
        });
        setSelectedOfferCycle(hasCurrentCycle ? currentCycle : (cycles[0]?.cycle || null));
    }

    async function addSelectedOfferToCart() {
        if (!selectedOffer?.product) return;
        await changeCartQuantity(selectedOffer.product, 1, { selectedCycle: selectedOfferCycle });
        setSelectedOffer(null);
        setSelectedOfferCycle(null);
    }

    function scrollToSummary() {
        const target = document.getElementById('resumo-compra');
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function persistCartItem(product, quantity, selectedCycle = null) {
        if (!user?.id || !product.store_product_id) return null;

        if (quantity <= 0) {
            return supabase
                .from('store_cart_items')
                .delete()
                .eq('profile_id', user.id)
                .eq('product_id', product.store_product_id);
        }

        return supabase
            .from('store_cart_items')
            .upsert({
                profile_id: user.id,
                product_id: product.store_product_id,
                quantity,
                metadata: {
                    selected_cycle: selectedCycle ? cycleLabelToStorageValue(selectedCycle) : null,
                },
            }, { onConflict: 'profile_id,product_id' });
    }

    async function changeCartQuantity(product, change, options = {}) {
        const currentEntry = cartMap[product.id];
        const currentQuantity = getCartEntryQuantity(currentEntry);
        const nextQuantity = Math.max(0, currentQuantity + change);
        const nextSelectedCycle = options.selectedCycle ?? getCartEntrySelectedCycle(currentEntry);

        if (!product.allow_multiple_units && nextQuantity > 1) return;

        setCartMap((previous) => {
            const updated = { ...previous };
            if (nextQuantity <= 0) {
                delete updated[product.id];
            } else {
                updated[product.id] = {
                    quantity: nextQuantity,
                    selectedCycle: nextSelectedCycle || null,
                };
            }
            return updated;
        });

        if (change > 0 && nextQuantity > 0) {
            trackAddToCart({
                contentName: product.name,
                value: (product.price_monthly_cents || 0) / 100,
            });
        }

        const result = await persistCartItem(product, nextQuantity, nextSelectedCycle);
        if (!product.store_product_id) {
            setStoreNotice('Produto sem preço definido: carrinho mantido localmente até você enviar os valores.');
            return;
        }

        if (result?.error) {
            if (String(result.error.message || '').toLowerCase().includes('metadata')) {
                const fallbackResult = await supabase
                    .from('store_cart_items')
                    .upsert({
                        profile_id: user.id,
                        product_id: product.store_product_id,
                        quantity: nextQuantity,
                    }, { onConflict: 'profile_id,product_id' });

                if (fallbackResult?.error) {
                    setStoreNotice('Carrinho salvo apenas localmente até finalizar setup de banco.');
                } else {
                    setStoreNotice('Carrinho salvo. Para manter o ciclo promocional após recarregar, execute a migração de metadata do carrinho.');
                }
            } else {
                setStoreNotice('Carrinho salvo apenas localmente até finalizar setup de banco.');
            }
        }
    }

    async function clearCart() {
        setCartMap({});
        if (!user?.id) return;

        const storeProductIds = products
            .map((item) => item.store_product_id)
            .filter(Boolean);

        if (!storeProductIds.length) return;

        const { error } = await supabase
            .from('store_cart_items')
            .delete()
            .eq('profile_id', user.id)
            .in('product_id', storeProductIds);

        if (error) {
            setStoreNotice('Não foi possível limpar no banco agora.');
        }
    }

    function buildWalletCheckoutItems() {
        return cartItems.map((item) => ({
            name: item.name,
            platform_id: item.platform_id || item.id,
            product_id: item.store_product_id,
            quantity: Number(item.quantity || 1),
            selected_cycle: item.selectedCycle || 'Mensal',
            selected_plan_total_cents: Number(item.selectedPlanTotalCents || 0),
        }));
    }

    function resolveTopupCreditsAmount() {
        if (creditBuyTab === 'sugestoes') {
            return Math.max(10, Number(selectedTopupCredits || 0));
        }

        const parsed = Number.parseInt(customTopupCredits || '0', 10);
        return Math.max(10, Number.isFinite(parsed) ? parsed : 0);
    }

    async function handleTopupPixCheckoutClick() {
        if (!user?.id) return;

        const topupCredits = resolveTopupCreditsAmount();
        if (!Number.isFinite(topupCredits) || topupCredits < 10) {
            setStoreNotice('A recarga mínima é de 10 créditos.');
            return;
        }

        const topupAmountCents = topupCredits * 100;

        setCheckoutLoading(true);
        try {
            const gateway = await getActiveGateway();
            const providerName = gateway === 'amplopay' ? 'amplopay' : 'banco_babylon';
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
                setStoreNotice('Não foi possível criar a recarga agora.');
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

                setStoreNotice(`Não foi possível iniciar a recarga PIX: ${gatewayError?.message || 'erro no gateway'}`);
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
                setStoreNotice(`Recarga recusada pelo gateway (status: ${gatewayStatus}).`);
                return;
            }

            setCheckoutSession({
                kind: 'topup',
                topupCredits,
                orderId: order.id,
                providerOrderId,
                status: gatewayStatus || 'pending',
                amountCents: topupAmountCents,
                checkoutUrl,
                pixCopyPasteCode,
                pixQrUrl,
                accessItems: [],
            });

            setStoreNotice('Recarga PIX criada. Finalize o pagamento para creditar seu saldo.');
        } finally {
            setCheckoutLoading(false);
        }
    }

    async function handleCreditCheckoutClick() {
        if (!cartItems.length || !user?.id) return;

        if (hasPendingPrices) {
            alert('Ainda existem itens sem valor definido no carrinho. Ajuste os itens pendentes para continuar.');
            return;
        }

        const requiredCredits = Math.max(Number(cartTotalPayableCredits || 0), 0);
        if (requiredCredits <= 0) {
            setStoreNotice('Não foi possível finalizar com crédito: total inválido.');
            return;
        }

        if (Number(walletBalance || 0) < requiredCredits) {
            setStoreNotice(`Saldo insuficiente para pagar com crédito. Saldo atual: ${walletBalance}. Necessário: ${requiredCredits}.`);
            return;
        }

        setCheckoutLoading(true);
        try {
            const { data, error } = await supabase.rpc('purchase_store_with_wallet', {
                p_items: sanitizePayloadForDatabase(buildWalletCheckoutItems()),
                p_idempotency_key: buildCheckoutIdempotencyKey(user.id),
            });

            if (error) {
                const errorMessage = String(error.message || '').toLowerCase();
                if (errorMessage.includes('purchase_store_with_wallet')) {
                    setStoreNotice('Compra por crédito ainda não está ativa no banco. Execute setup_wallet_credit_checkout.sql.');
                } else {
                    setStoreNotice(`Não foi possível concluir com crédito: ${error.message}`);
                }
                return;
            }

            const status = String(data?.status || '').toLowerCase();
            if (status === 'insufficient_balance') {
                const currentBalance = Number(data?.current_balance || walletBalance || 0);
                const neededCredits = Number(data?.required_credits || requiredCredits);
                setWalletBalance(currentBalance);
                setStoreNotice(`Saldo insuficiente para pagar com crédito. Saldo atual: ${currentBalance}. Necessário: ${neededCredits}.`);
                return;
            }

            if (status !== 'paid_and_access_granted' && status !== 'already_processed') {
                if (status === 'invalid_item_product') {
                    setStoreNotice('Não foi possível concluir com crédito: produto da loja não encontrado para uma das plataformas.');
                } else if (status === 'no_available_accounts_for_platform') {
                    setStoreNotice('Não foi possível concluir com crédito: não há contas disponíveis para uma das plataformas no momento. Avise o suporte/admin para liberar novas contas.');
                } else if (status === 'platform_not_mapped') {
                    setStoreNotice('Não foi possível concluir com crédito: plataforma sem vínculo de produto na loja.');
                } else if (status === 'invalid_item_price' || status === 'item_price_mismatch') {
                    setStoreNotice('Não foi possível concluir com crédito: os valores do plano foram alterados. Reabra o carrinho e tente novamente.');
                } else if (status === 'wallet_checkout_error') {
                    const reason = String(data?.reason || '').toLowerCase();
                    if (reason.includes('no_available_accounts_for_platform')) {
                        setStoreNotice('Não foi possível concluir com crédito: não há contas disponíveis para uma das plataformas no momento. Avise o suporte/admin para liberar novas contas.');
                    } else {
                        setStoreNotice(`Não foi possível concluir com crédito: ${data?.reason || 'erro interno no checkout de carteira.'}`);
                    }
                } else {
                    setStoreNotice(`Não foi possível finalizar a compra com crédito agora (status: ${status || 'desconhecido'}).`);
                }
                return;
            }

            const nextBalance = Number(data?.new_balance);
            if (Number.isFinite(nextBalance)) {
                setWalletBalance(nextBalance);
            } else {
                setWalletBalance((previous) => Math.max(0, Number(previous || 0) - requiredCredits));
            }

            await clearCart();

            trackPurchase({
                value: requiredCredits,
                numItems: cartItems.length,
                contentName: cartItems.map((i) => i.name).join(', '),
            });

            setStoreNotice('Pagamento com crédito confirmado. Acesso liberado nas plataformas.');
            navigate('/plataformas');
        } finally {
            setCheckoutLoading(false);
        }
    }

    async function handlePixCheckoutClick() {
        if (!cartItems.length || !user?.id) return;

        if (hasPendingPrices) {
            alert('Ainda existem itens sem valor definido no carrinho. Ajuste os itens pendentes para continuar.');
            return;
        }

        setCheckoutLoading(true);
        try {
            const checkoutAmountCents = Math.max(Number(cartTotalPayableCents || 0), 0);
            if (checkoutAmountCents <= 0) {
                setStoreNotice('Não foi possível iniciar o checkout: valor total inválido.');
                return;
            }

            const gateway = await getActiveGateway();
            const providerName = gateway === 'amplopay' ? 'amplopay' : 'banco_babylon';

            const idempotencyKey = buildCheckoutIdempotencyKey(user.id);
            const checkoutAccessItems = cartItems.map((item) => ({
                name: item.name,
                quantity: Number(item.quantity || 1),
                cycle: item.selectedCycle || 'Mensal',
            }));

            const baseMetadata = sanitizePayloadForDatabase({
                source: 'loja_plataformas',
                payment_provider: providerName,
                total_plan_cents: cartTotalPlanCents,
                total_monthly_cents: cartTotalMonthlyCents,
                total_payable_cents: cartTotalPayableCents,
                items: cartItems.map((item) => ({
                    name: item.name,
                    platform_id: item.id,
                    product_id: item.store_product_id,
                    quantity: item.quantity,
                    credit_cost: item.credit_cost,
                    price_monthly_cents: item.price_monthly_cents,
                    selected_cycle: item.selectedCycle,
                    selected_plan_total_cents: item.selectedPlanTotalCents,
                    selected_monthly_equivalent_cents: item.selectedMonthlyEquivalentCents,
                })),
            });

            const { data: order, error: orderError } = await supabase
                .from('checkout_orders')
                .insert({
                    profile_id: user.id,
                    status: 'draft',
                    provider_name: providerName,
                    idempotency_key: idempotencyKey,
                    total_credit_cost: cartTotalPayableCredits,
                    metadata: baseMetadata,
                })
                .select('id')
                .maybeSingle();

            if (orderError || !order?.id) {
                setStoreNotice('Não foi possível criar o pedido de checkout agora.');
                return;
            }

            let transactionResponse;
            try {
                const checkoutItems = [{
                    title: `Checkout loja (${cartItems.length} item(ns))`,
                    unitPrice: checkoutAmountCents,
                    quantity: 1,
                    externalRef: order.id,
                }];

                transactionResponse = await createBabylonTransaction(sanitizePayloadForDatabase({
                    amount: checkoutAmountCents,
                    currency: 'BRL',
                    payment_method: 'PIX',
                    paymentMethod: 'PIX',
                    customer: buildBabylonCustomer(user),
                    items: checkoutItems,
                    external_id: order.id,
                    externalRef: order.id,
                    idempotency_key: idempotencyKey,
                    description: 'Compra de acesso a plataformas',
                    metadata: {
                        checkout_order_id: order.id,
                        total_credit_cost: cartTotalPayableCredits,
                        source: 'loja_plataformas',
                    },
                }));
            } catch (gatewayError) {
                const gatewayMessage = sanitizeTextForDatabase(gatewayError?.message || 'gateway_error');
                await supabase
                    .from('checkout_orders')
                    .update({
                        status: 'failed',
                        metadata: sanitizePayloadForDatabase({
                            ...baseMetadata,
                            payment_provider: 'banco_babylon',
                            payment_error: gatewayMessage,
                        }),
                    })
                    .eq('id', order.id);

                setStoreNotice(`Não foi possível iniciar o pagamento na Babylon: ${gatewayMessage}`);
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

            const gatewayReason = sanitizeTextForDatabase(
                transactionResponse?.refusedReason?.description
                || transactionResponse?.refused_reason?.description
                || transactionResponse?.data?.refusedReason?.description
                || transactionResponse?.data?.refused_reason?.description
                || transactionResponse?.message
                || transactionResponse?.data?.message
                || ''
            );

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
                        payment_provider: providerName,
                        gateway_order_id: providerOrderId,
                        gateway_status: gatewayStatus,
                        gateway_reason: gatewayReason || null,
                        checkout_url: checkoutUrl,
                        pix_copy_paste_code: pixCopyPasteCode,
                        pix_qr_url: pixQrUrl,
                    }),
                })
                .eq('id', order.id);

            if (!isGatewayFailure) {
                await clearCart();
            }

            if (isGatewayFailure) {
                setStoreNotice(
                    gatewayReason
                        ? `Pagamento recusado pelo gateway: ${gatewayReason}`
                        : `Pagamento recusado pelo gateway (status: ${gatewayStatus}).`
                );
                return;
            }

            setCheckoutSession({
                orderId: order.id,
                providerOrderId,
                status: gatewayStatus || 'pending',
                amountCents: checkoutAmountCents,
                checkoutUrl,
                pixCopyPasteCode,
                pixQrUrl,
                accessItems: checkoutAccessItems,
            });

            if (checkoutUrl) {
                setStoreNotice('Pedido criado com sucesso. Finalize o pagamento no checkout abaixo.');
            } else if (pixCopyPasteCode) {
                await copyPixCode(pixCopyPasteCode);
                setStoreNotice('Pedido PIX criado. Use o checkout abaixo para concluir o pagamento.');
            } else {
                const normalizedStatus = gatewayStatus || 'pending';
                setStoreNotice(
                    gatewayReason
                        ? `Pedido criado na Babylon (status: ${normalizedStatus}). Detalhe: ${gatewayReason}`
                        : `Pedido criado na Babylon (status: ${normalizedStatus}). Aguardando dados de pagamento.`
                );
            }
        } finally {
            setCheckoutLoading(false);
        }
    }

    function handleContinueToPaymentOptions() {
        if (!cartItems.length) return;
        if (hasPendingPrices) {
            setStoreNotice('Ainda existem itens sem valor definido no carrinho. Ajuste os itens pendentes para continuar.');
            return;
        }

        trackInitiateCheckout({
            value: (cartTotalPayableCents || 0) / 100,
            numItems: cartItems.length,
            contentName: cartItems.map((i) => i.name).join(', '),
        });

        setIsPaymentMethodModalOpen(true);
    }

    return (
        <div className={`space-y-6 max-w-screen-2xl mx-auto ${cartItems.length ? 'pb-24' : ''}`}>
            {storeNotice ? (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
                    {storeNotice}
                </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-primary" /> Escolha suas Plataformas
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 px-4 pt-4 pb-6 md:px-5">
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setCatalogTab('todos')}
                                className={catalogTab === 'todos'
                                    ? 'rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary'
                                    : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10'}
                            >
                                Todos
                            </button>
                            <button
                                type="button"
                                onClick={() => setCatalogTab('streaming')}
                                className={catalogTab === 'streaming'
                                    ? 'rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary'
                                    : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10'}
                            >
                                Streaming
                            </button>
                        </div>

                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Pesquisar plataforma..."
                                className="pl-9"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                            {filteredProducts.map((product) => {

                                return (
                                    <article key={product.id} className="group rounded-2xl border border-white/10 bg-black/20 p-3 transition-all hover:border-primary/30 hover:bg-white/5 h-full flex flex-col">
                                        <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/10 flex items-center justify-center">
                                            {product.image_url ? (
                                                <img src={product.image_url} alt={product.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                            ) : (
                                                <div className="flex flex-col items-center gap-1 text-gray-500">
                                                    <ImageIcon className="h-6 w-6" />
                                                    <span className="text-xs">Sem imagem</span>
                                                </div>
                                            )}

                                        </div>

                                        <div className="mt-3 space-y-2 flex flex-col flex-1">
                                            <h4 className="font-semibold text-white leading-tight line-clamp-2">{product.name}</h4>

                                            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                                <p className="text-sm font-semibold text-white">
                                                    {product.price_monthly_cents > 0
                                                        ? `${formatBRLFromCents(product.price_monthly_cents)}/mês`
                                                        : (product.has_defined_price ? `${product.credit_cost} créditos` : 'Valor em definição')}
                                                </p>
                                                {!product.has_defined_price ? (
                                                    <p className="text-[11px] text-yellow-300">Envie os valores que eu atualizo em seguida.</p>
                                                ) : null}
                                            </div>

                                            <Button
                                                type="button"
                                                className="w-full mt-auto"
                                                onClick={() => openOfferDetails(product)}
                                            >
                                                Comprar
                                            </Button>

                                        </div>
                                    </article>
                                );
                            })}
                        </div>

                        {!filteredProducts.length ? (
                            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
                                Nenhuma plataforma encontrada para essa busca.
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <Card id="resumo-compra" className="h-fit lg:sticky lg:top-24 lg:self-start">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Wallet className="h-5 w-5 text-primary" /> Resumo do Pagamento
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Itens</p>
                                    <p className="mt-1 text-xl font-bold text-white">{cartUnits}</p>
                                </div>

                                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Saldo</p>
                                    <p className="mt-1 text-sm font-semibold text-white">
                                        {walletLoaded ? formatBRLFromCredits(walletBalance) : '...'}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                                <p className="text-[11px] uppercase tracking-wide text-primary/80">Total a pagar</p>
                                <p className="mt-1 text-xl font-bold text-white">
                                    {cartTotalPayableCents > 0 ? formatBRLFromCents(cartTotalPayableCents) : '—'}
                                </p>
                                {monthlyAccessPromoSummary.discountCents > 0 ? (
                                    <p className="mt-1 text-xs text-emerald-300">
                                        Desconto aplicado: -{formatBRLFromCents(monthlyAccessPromoSummary.discountCents)}
                                    </p>
                                ) : null}
                            </div>
                        </div>

                        <div className="max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/20 divide-y divide-white/10">
                            {cartItems.length === 0 ? (
                                <p className="px-3 py-4 text-sm text-gray-500">Seu carrinho está vazio. Adicione plataformas na vitrine.</p>
                            ) : cartItems.map((item) => (
                                <div key={item.id} className="px-3 py-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                                            <p className="mt-1 text-xs text-gray-400">
                                                {(item.selectedCycle || 'Mensal')} · x{item.quantity}
                                            </p>
                                        </div>
                                        <span className="shrink-0 min-w-[86px] text-right text-sm font-bold text-white whitespace-nowrap">
                                            {item.selectedPlanTotalCents > 0
                                                ? formatBRLFromCents(item.subtotalPlanTotalCents)
                                                : (item.has_defined_price ? `${item.subtotal} créditos` : 'Pendente')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="w-full"
                                type="button"
                                onClick={clearCart}
                                disabled={!cartItems.length}
                            >
                                Limpar
                            </Button>
                            <Button
                                className="w-full"
                                type="button"
                                onClick={handleContinueToPaymentOptions}
                                disabled={!cartItems.length}
                            >
                                Continuar
                            </Button>
                        </div>

                        <p className="text-[11px] text-gray-500">
                            Clique em continuar para escolher a forma de pagamento (crédito ou PIX).
                        </p>
                    </CardContent>
                </Card>
            </div>

            {cartItems.length > 0 ? (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#141414]/85 backdrop-blur-md">
                    <div className="mx-auto max-w-7xl px-4 py-2.5 md:px-8">
                        <div className="flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-3.5 py-2.5 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400">{cartUnits} item(ns) no carrinho</p>

                    <Modal
                        isOpen={isTopupModalOpen}
                        onClose={() => setIsTopupModalOpen(false)}
                        title="Comprar Créditos (PIX)"
                    >
                        <div className="space-y-4">
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
                                onClick={async () => {
                                    await handleTopupPixCheckoutClick();
                                    setIsTopupModalOpen(false);
                                }}
                                isLoading={checkoutLoading}
                            >
                                Comprar créditos com PIX
                            </Button>
                        </div>
                    </Modal>
                                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">Total a pagar</p>
                                <div className="mt-0.5 flex items-baseline gap-2">
                                    <span className="text-base font-semibold text-white">
                                        {formatBRLFromCents(cartTotalPayableCents)}
                                    </span>
                                    <span className="text-xs text-gray-500">({cartTotalPayableCredits} créditos)</span>
                                </div>
                                {monthlyAccessPromoSummary.discountCents > 0 ? (
                                    <p className="mt-0.5 text-xs text-emerald-300">
                                        Desconto: -{formatBRLFromCents(monthlyAccessPromoSummary.discountCents)}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex w-full items-center gap-2 md:w-auto md:justify-end">
                                <Button
                                    variant="outline"
                                    type="button"
                                    onClick={scrollToSummary}
                                    size="sm"
                                    className="flex-1 border-white/20 text-gray-100 hover:bg-white/10 hover:border-white/40 md:flex-none"
                                >
                                Ver resumo
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleContinueToPaymentOptions}
                                    disabled={!cartItems.length}
                                    size="sm"
                                    className="flex-1 border-primary/40 bg-primary text-white shadow-none hover:bg-primary-hover hover:shadow-none md:flex-none"
                                >
                                Continuar
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            <Modal
                isOpen={isPaymentMethodModalOpen}
                onClose={() => setIsPaymentMethodModalOpen(false)}
                title="Forma de Pagamento"
                className="max-w-3xl"
                contentClassName="px-4 md:px-6 pb-6 pt-3 overflow-y-auto max-h-[calc(100dvh-8rem)]"
            >
                <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-gray-400">Saldo</p>
                                <p className="mt-1 text-sm font-semibold text-white">{walletLoaded ? formatBRLFromCredits(walletBalance) : '...'}</p>
                            </div>
                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-primary/80">Total</p>
                                <p className="mt-1 text-sm font-bold text-white">{formatBRLFromCents(cartTotalPayableCents)}</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Button
                            type="button"
                            className="h-12 w-full text-base"
                            isLoading={checkoutLoading}
                            onClick={async () => {
                                await handlePixCheckoutClick();
                                setIsPaymentMethodModalOpen(false);
                            }}
                        >
                            Pagar com PIX
                        </Button>

                        <Button
                            type="button"
                            variant="outline"
                            className="h-12 w-full"
                            isLoading={checkoutLoading}
                            onClick={async () => {
                                await handleCreditCheckoutClick();
                                setIsPaymentMethodModalOpen(false);
                            }}
                        >
                            Pagar com saldo
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={!!selectedOffer}
                onClose={() => {
                    setSelectedOffer(null);
                    setSelectedOfferCycle(null);
                }}
                title={selectedOffer?.title || 'Planos econômicos'}
            >
                {selectedOffer ? (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <p className="text-sm text-gray-300">{selectedOffer.subtitle}</p>
                            <p className="text-xs text-primary mt-1">{selectedOffer.highlight}</p>
                        </div>

                        <div className="space-y-2">
                            {selectedOffer.cycles?.length ? selectedOffer.cycles.map((cycle) => {
                                const active = selectedOfferCycle === cycle.cycle;
                                const offPercent = calculateCycleOffPercent(cycle, selectedOffer?.product?.price_monthly_cents);
                                return (
                                    <button
                                        key={`${selectedOffer.title}-${cycle.cycle}`}
                                        type="button"
                                        onClick={() => setSelectedOfferCycle(cycle.cycle)}
                                        className={active
                                            ? 'w-full rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 flex items-center justify-between text-left'
                                            : 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 flex items-center justify-between text-left hover:bg-white/10'}
                                    >
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs text-gray-400">{cycle.cycle}</p>
                                                {offPercent > 0 ? (
                                                    <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-400">
                                                        {offPercent}% OFF
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="text-sm font-semibold text-white">{formatBRLFromCents(cycle.totalCents)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[11px] text-gray-400">Equivalente</p>
                                            <p className={active ? 'text-sm font-semibold text-primary' : 'text-sm font-semibold text-white'}>{cycle.monthlyText}</p>
                                        </div>
                                    </button>
                                );
                            }) : (
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                    <p className="text-sm text-gray-300">Sem ciclos econômicos cadastrados para este acesso no momento.</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="w-full"
                                type="button"
                                onClick={() => {
                                    setSelectedOffer(null);
                                    setSelectedOfferCycle(null);
                                }}
                            >
                                Voltar
                            </Button>
                            <Button
                                className="w-full"
                                type="button"
                                onClick={addSelectedOfferToCart}
                            >
                                Adicionar ao carrinho
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                isOpen={!!checkoutSession}
                onClose={() => {
                    setCheckoutSession(null);
                    setLastCopiedField('');
                }}
                title="Checkout PIX"
                contentClassName="overflow-y-scroll"
            >
                {checkoutSession ? (
                    <div className="space-y-4">
                        {(() => {
                            const fallbackQrUrl = checkoutSession?.pixCopyPasteCode
                                ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(String(checkoutSession.pixCopyPasteCode))}`
                                : null;
                            const pixQrDisplayUrl = checkoutSession?.pixQrUrl || fallbackQrUrl;
                            return (
                                <>
                        <div className="space-y-3 border-b border-white/10 pb-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white">
                                    {checkoutSession.kind === 'topup' ? 'Resumo da recarga' : 'Resumo da compra'}
                                </h3>
                                <span className={checkoutSession.status === 'paid' ? 'rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-300' : checkoutSession.status === 'failed' ? 'rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300' : 'rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-semibold text-yellow-300'}>
                                    {checkoutSession.status || 'pending'}
                                </span>
                            </div>
                            {checkoutSession.kind === 'topup' ? (
                                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-200">
                                    Recarga de <span className="font-semibold text-white">{Number(checkoutSession?.topupCredits || 0)} créditos</span>
                                </div>
                            ) : Array.isArray(checkoutSession.accessItems) && checkoutSession.accessItems.length ? (
                                <div className="space-y-1.5">
                                    {checkoutSession.accessItems.map((entry, index) => (
                                        <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-gray-100 font-medium truncate">{entry.name || 'Acesso'}</span>
                                            <span className="text-gray-300 whitespace-nowrap">{entry.quantity || 1}x • {entry.cycle || 'Mensal'}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-gray-400">Acesso em processamento.</p>
                            )}
                            <div className="flex items-center justify-between border-t border-white/10 pt-2">
                                <span className="text-sm text-gray-300">Total</span>
                                <span className="text-base font-semibold text-white">{formatBRLFromCents(checkoutSession.amountCents || 0)}</span>
                            </div>
                        </div>

                        {checkoutSession.status === 'paid' ? (
                            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 flex items-center gap-2 text-green-300 text-sm">
                                <CheckCircle2 className="h-4 w-4" /> Pagamento confirmado. Acesso liberado.
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

                        {checkoutSession.pixCopyPasteCode ? (
                            <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                                <p className="text-xs text-gray-400">2) PIX Copia e Cola</p>
                                <textarea
                                    readOnly
                                    value={checkoutSession.pixCopyPasteCode}
                                    onClick={() => copyPixCode(checkoutSession.pixCopyPasteCode)}
                                    className="w-full min-h-24 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-200 cursor-copy"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="w-full"
                                    onClick={() => copyPixCode(checkoutSession.pixCopyPasteCode)}
                                >
                                    <Copy className="h-4 w-4 mr-2" /> Copiar código PIX
                                </Button>
                                {lastCopiedField === 'pix_code' ? (
                                    <p className="text-[11px] text-green-400">Código PIX copiado com sucesso.</p>
                                ) : null}
                            </div>
                        ) : null}

                        {checkoutSession.status !== 'paid' && checkoutSession.status !== 'failed' ? (
                            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 flex items-center gap-2 text-xs text-green-200">
                                <span className="relative inline-flex h-2.5 w-2.5">
                                    <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-70 animate-ping" />
                                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-400" />
                                </span>
                                <RefreshCw className="h-4 w-4 text-green-300 animate-spin" />
                                <span>
                                    {paymentChecking
                                        ? 'Verificando pagamento PIX agora...'
                                        : 'Aguardando confirmação do PIX (checagem automática a cada 5 segundos).'}
                                </span>
                            </div>
                        ) : null}

                        <Button
                            type="button"
                            className="w-full"
                            onClick={() => {
                                setCheckoutSession(null);
                                setLastCopiedField('');
                                navigate('/plataformas');
                            }}
                        >
                            Continuar nas Plataformas
                        </Button>
                                </>
                            );
                        })()}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
