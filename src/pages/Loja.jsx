import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Wallet, Image as ImageIcon, Sparkles, Search } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { createBabylonTransaction } from '../lib/babylonApi';

const FORBIDDEN_DB_TEXT_REGEX = /salva\s*universit[aá]rio/gi;

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

function buildDefaultCyclesFromMonthly(monthlyCents) {
    const mensal = Math.round(monthlyCents);
    const trimestral = Math.round(monthlyCents * 3 * 0.95);
    const semestral = Math.round(monthlyCents * 6 * 0.9);
    const anual = Math.round(monthlyCents * 12 * 0.8);

    return [
        { cycle: 'Mensal', totalCents: mensal, monthlyText: toMonthlyText(mensal, 1) },
        { cycle: 'Trimestral', totalCents: trimestral, monthlyText: toMonthlyText(trimestral, 3) },
        { cycle: 'Semestral', totalCents: semestral, monthlyText: toMonthlyText(semestral, 6) },
        { cycle: 'Anual', totalCents: anual, monthlyText: toMonthlyText(anual, 12), isBest: true },
    ];
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
    const cyclesFromMetadata = buildCyclesFromMetadata(product?.offer_plans);
    if (cyclesFromMetadata.length) return cyclesFromMetadata;
    if (Number(product?.price_monthly_cents || 0) > 0) {
        return buildDefaultCyclesFromMonthly(Number(product.price_monthly_cents));
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

export function Loja() {
    const { user } = useAuth();
    const [walletBalance, setWalletBalance] = useState(0);
    const [walletLoaded, setWalletLoaded] = useState(false);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [catalogTab, setCatalogTab] = useState('todos');
    const [cartMap, setCartMap] = useState({});
    const [storeNotice, setStoreNotice] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [selectedOfferCycle, setSelectedOfferCycle] = useState(null);

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
                const linkedStoreProduct = safeStoreProducts.find((product) => {
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

            return {
                ...product,
                quantity,
                selectedCycle: selectedCycleData?.cycle || null,
                selectedCycleMonths,
                selectedPlanTotalCents: selectedTotalCents,
                selectedMonthlyEquivalentCents,
                subtotal: Number(product.credit_cost || 0) * quantity,
                subtotalPlanTotalCents: selectedTotalCents * quantity,
                subtotalMonthlyCents: selectedMonthlyEquivalentCents * quantity,
            };
        })
        .filter(Boolean), [products, cartMap]);

    const cartTotal = useMemo(
        () => cartItems.reduce((total, item) => total + item.subtotal, 0),
        [cartItems]
    );

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

    const cartUnits = useMemo(
        () => cartItems.reduce((total, item) => total + item.quantity, 0),
        [cartItems]
    );

    const hasPendingPrices = useMemo(
        () => cartItems.some((item) => !item.has_defined_price || item.credit_cost <= 0),
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
        setStoreNotice(
            selectedOfferCycle
                ? `${selectedOffer.product.name} adicionado ao carrinho. Ciclo selecionado: ${selectedOfferCycle}.`
                : `${selectedOffer.product.name} adicionado ao carrinho.`
        );
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

    async function handleCheckoutClick() {
        if (!cartItems.length || !user?.id) return;

        if (hasPendingPrices) {
            alert('Ainda existem itens sem valor definido. Me envie os preços e combos para liberar o checkout.');
            return;
        }

        setCheckoutLoading(true);
        try {
            const checkoutAmountCents = Math.max(Number(cartTotalPlanCents || 0), Number(cartTotalMonthlyCents || 0));
            if (checkoutAmountCents <= 0) {
                setStoreNotice('Não foi possível iniciar o checkout: valor total inválido.');
                return;
            }

            const idempotencyKey = buildCheckoutIdempotencyKey(user.id);
            const baseMetadata = sanitizePayloadForDatabase({
                source: 'loja_plataformas',
                payment_provider: 'banco_babylon',
                total_plan_cents: cartTotalPlanCents,
                total_monthly_cents: cartTotalMonthlyCents,
                items: cartItems.map((item) => ({
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
                    provider_name: 'banco_babylon',
                    idempotency_key: idempotencyKey,
                    total_credit_cost: cartTotal,
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
                transactionResponse = await createBabylonTransaction(sanitizePayloadForDatabase({
                    amount: Number((checkoutAmountCents / 100).toFixed(2)),
                    amount_cents: checkoutAmountCents,
                    currency: 'BRL',
                    external_id: order.id,
                    idempotency_key: idempotencyKey,
                    description: 'Compra de acesso a plataformas',
                    metadata: {
                        checkout_order_id: order.id,
                        total_credit_cost: cartTotal,
                        source: 'loja_plataformas',
                    },
                }));
            } catch (gatewayError) {
                await supabase
                    .from('checkout_orders')
                    .update({
                        status: 'failed',
                        metadata: sanitizePayloadForDatabase({
                            ...baseMetadata,
                            payment_provider: 'banco_babylon',
                            payment_error: sanitizeTextForDatabase(gatewayError?.message || 'gateway_error'),
                        }),
                    })
                    .eq('id', order.id);

                setStoreNotice('Não foi possível iniciar o pagamento na Babylon. Tente novamente em instantes.');
                return;
            }

            const providerOrderId = transactionResponse?.provider_order_id
                || transactionResponse?.order_id
                || transactionResponse?.transaction_id
                || transactionResponse?.id
                || transactionResponse?.data?.id
                || null;

            const checkoutUrl = transactionResponse?.checkout_url
                || transactionResponse?.payment_url
                || transactionResponse?.url
                || transactionResponse?.data?.checkout_url
                || transactionResponse?.data?.payment_url
                || null;

            await supabase
                .from('checkout_orders')
                .update({
                    status: 'pending',
                    provider_name: 'banco_babylon',
                    provider_order_id: providerOrderId,
                    metadata: sanitizePayloadForDatabase({
                        ...baseMetadata,
                        payment_provider: 'banco_babylon',
                        gateway_order_id: providerOrderId,
                        gateway_status: transactionResponse?.status || transactionResponse?.data?.status || 'pending',
                        checkout_url: checkoutUrl,
                    }),
                })
                .eq('id', order.id);

            await clearCart();

            if (checkoutUrl) {
                setStoreNotice('Pedido criado com sucesso. Abrindo checkout da Babylon...');
                window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
            } else {
                setStoreNotice('Pedido criado e enviado para Babylon. Acompanhe a confirmação do pagamento.');
            }
        } finally {
            setCheckoutLoading(false);
        }
    }

    return (
        <div className={`space-y-6 max-w-7xl mx-auto ${cartItems.length ? 'pb-24' : ''}`}>
            <Card>
                <CardHeader>
                    <CardTitle>Como funcionam os planos econômicos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-gray-300">
                        Aqui você escolhe entre <span className="text-white font-medium">acesso individual</span> ou <span className="text-white font-medium">combos</span>. Quanto maior o ciclo (trimestral, semestral, anual), menor o custo mensal.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-400">
                        <li>• Se quer 1 plataforma específica: escolha <span className="text-white">individual</span>.</li>
                        <li>• Se quer mais de uma plataforma: compare os <span className="text-white">combos econômicos</span>.</li>
                        <li>• Para pagar menos por mês: priorize o <span className="text-white">plano anual</span>.</li>
                    </ul>
                </CardContent>
            </Card>

            {storeNotice ? (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
                    {storeNotice}
                </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-primary" /> Escolha suas Plataformas
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
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

                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            {filteredProducts.map((product) => {

                                return (
                                    <article key={product.id} className="group rounded-2xl border border-white/10 bg-black/20 p-3 transition-all hover:border-primary/30 hover:bg-white/5">
                                        <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/10 flex items-center justify-center">
                                            {product.image_url ? (
                                                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                            ) : (
                                                <div className="flex flex-col items-center gap-1 text-gray-500">
                                                    <ImageIcon className="h-6 w-6" />
                                                    <span className="text-xs">Sem imagem</span>
                                                </div>
                                            )}

                                        </div>

                                        <div className="mt-3 space-y-2">
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
                                                className="w-full"
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

                <Card id="resumo-compra" className="lg:sticky lg:top-24 h-fit">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Wallet className="h-5 w-5 text-primary" /> Resumo do Pagamento
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Itens selecionados</span>
                                <span className="font-semibold text-white">{cartUnits}</span>
                            </div>
                            {cartTotal > 0 ? (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Total em créditos</span>
                                    <span className="font-semibold text-primary">{cartTotal}</span>
                                </div>
                            ) : null}
                            {monthlyAccessPromoSummary.discountCents > 0 ? (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Subtotal mensal (sem promoção)</span>
                                    <span className="font-semibold text-white">{formatBRLFromCents(monthlyAccessPromoSummary.regularCents)}/mês</span>
                                </div>
                            ) : null}
                            {monthlyAccessPromoSummary.discountCents > 0 ? (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-green-400">Desconto combo mensal</span>
                                    <span className="font-semibold text-green-400">- {formatBRLFromCents(monthlyAccessPromoSummary.discountCents)}</span>
                                </div>
                            ) : null}
                            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                                <span className="text-sm font-medium text-primary">Total a pagar</span>
                                <span className="text-base font-bold text-white">{cartTotalMonthlyCents > 0 ? `${formatBRLFromCents(cartTotalMonthlyCents)}/mês` : '—'}</span>
                            </div>
                            {monthlyAccessPromoSummary.discountCents === 0 && cartTotalPlanCents > 0 ? (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Total dos planos selecionados</span>
                                    <span className="font-semibold text-white">{formatBRLFromCents(cartTotalPlanCents)}</span>
                                </div>
                            ) : null}
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Saldo atual</span>
                                <span className="font-semibold text-white">{walletLoaded ? walletBalance : '...'}</span>
                            </div>
                        </div>

                        <div className="space-y-2 max-h-56 overflow-auto pr-1">
                            {cartItems.length === 0 ? (
                                <p className="text-xs text-gray-500">Seu carrinho está vazio. Adicione plataformas na vitrine.</p>
                            ) : cartItems.map((item) => (
                                <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <p className="text-xs font-medium text-white truncate">{item.name}</p>
                                    <p className="text-[11px] text-gray-400">
                                        {item.quantity}x • {(item.selectedCycle || 'Mensal')} • {item.selectedPlanTotalCents > 0
                                            ? `${formatBRLFromCents(item.subtotalMonthlyCents)}/mês`
                                            : (item.has_defined_price ? `${item.subtotal} créditos` : 'Valor pendente')}
                                    </p>
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
                                onClick={handleCheckoutClick}
                                isLoading={checkoutLoading}
                                disabled={!cartItems.length || hasPendingPrices}
                            >
                                Continuar
                            </Button>
                        </div>

                        <p className="text-[11px] text-gray-500">
                            Depois que você enviar valores de acessos e combos, eu habilito checkout completo com integração webhook.
                        </p>
                    </CardContent>
                </Card>
            </div>

            {cartItems.length > 0 ? (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#141414]/95 backdrop-blur-md">
                    <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
                        <div>
                            <p className="text-xs text-gray-400">{cartUnits} item(ns) no carrinho</p>
                            <p className="text-sm font-semibold text-white">
                                Total a pagar: {cartTotalMonthlyCents > 0 ? `${formatBRLFromCents(cartTotalMonthlyCents)}/mês` : `${cartTotal} créditos`}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" type="button" onClick={scrollToSummary}>
                                Ver resumo
                            </Button>
                            <Button
                                type="button"
                                onClick={handleCheckoutClick}
                                isLoading={checkoutLoading}
                                disabled={hasPendingPrices}
                            >
                                Continuar
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

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
        </div>
    );
}
