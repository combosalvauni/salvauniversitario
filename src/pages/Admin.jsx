import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Users, Plus, Edit, Trash2, Search, CheckCircle, XCircle, Loader2, KeyRound, ChevronUp, ChevronDown, GripVertical, MessageSquare, ShoppingCart } from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { PlansSettingsPanel } from '../components/admin/PlansSettingsPanel';

const STREAMING_NAME_HINTS = [
    'netflix', 'prime', 'amazonprime', 'disney', 'hbo', 'max', 'globoplay', 'globopay', 'youtube',
    'paramount', 'paramout', 'crunchyroll', 'espn', 'tnt', 'hulu', 'appletv', 'telecine', 'mubi',
];

function hasStreamingHint(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!key) return false;
    return STREAMING_NAME_HINTS.some((hint) => key.includes(hint));
}

function isStreamingStoreItem(product, platform) {
    if (!product) return false;
    if (product?.metadata?.is_streaming === true) return true;
    if (product?.metadata?.is_streaming === false) return false;

    return hasStreamingHint(product?.name)
        || hasStreamingHint(product?.slug)
        || hasStreamingHint(platform?.name);
}

function ReorderablePlatformRow({
    course,
    dragEnabled,
    onCommitOrder,
    onMoveUp,
    onMoveDown,
    disableMoveUp,
    disableMoveDown,
    onManageAccounts,
    onEdit,
    onDelete,
}) {
    const dragControls = useDragControls();

    return (
        <Reorder.Item
            as="tr"
            value={course}
            dragListener={false}
            dragControls={dragControls}
            onDragEnd={() => dragEnabled && onCommitOrder()}
            className="border-b border-white/5 hover:bg-white/5 transition-colors"
        >
            <td className="px-2 py-3 sm:px-3 sm:py-4 align-middle">
                <button
                    type="button"
                    onPointerDown={(e) => {
                        if (!dragEnabled) return;
                        dragControls.start(e);
                    }}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        dragEnabled ? "text-gray-300 hover:bg-white/5 cursor-grab active:cursor-grabbing" : "text-gray-600 cursor-not-allowed"
                    )}
                    title={dragEnabled ? 'Arrastar para reordenar' : 'Limpe a busca para reordenar'}
                    aria-label="Arrastar para reordenar"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
            </td>

            <td className="px-3 py-3 sm:px-6 sm:py-4 font-medium text-white">
                <div className="flex items-center gap-3 min-w-0">
                    {course.image_url && (
                        <img src={course.image_url} className="hidden sm:block w-8 h-8 rounded object-cover" />
                    )}
                    <span className="truncate">{course.name}</span>
                </div>
            </td>
            <td className="hidden sm:table-cell px-6 py-4">—</td>
            <td className="hidden sm:table-cell px-6 py-4">
                <span className={cn(
                    "rounded-full px-2 py-1 text-xs font-medium",
                    course.status === 'active'
                        ? "bg-green-500/10 text-green-500"
                        : "bg-white/5 text-gray-400"
                )}>
                    {course.status}
                </span>
            </td>
            <td className="px-3 py-3 sm:px-6 sm:py-4 text-right">
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onMoveUp}
                        disabled={disableMoveUp}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            disableMoveUp
                                ? "text-gray-600 cursor-not-allowed"
                                : "text-gray-300 hover:bg-white/5"
                        )}
                        title="Subir"
                    >
                        <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onMoveDown}
                        disabled={disableMoveDown}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            disableMoveDown
                                ? "text-gray-600 cursor-not-allowed"
                                : "text-gray-300 hover:bg-white/5"
                        )}
                        title="Descer"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onManageAccounts}
                        className="p-2 text-gray-300 hover:bg-white/5 rounded-lg transition-colors"
                        title="Contas"
                    >
                        <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onEdit}
                        className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="Editar"
                    >
                        <Edit className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Excluir"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </td>
        </Reorder.Item>
    );
}

export function Admin() {
    const [activeTab, setActiveTab] = useState('courses');
    const [search, setSearch] = useState('');

    const [courses, setCourses] = useState([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [reorderSaving, setReorderSaving] = useState(false);
    const [orderDirty, setOrderDirty] = useState(false);
    const coursesRef = useRef(courses);
    const orderDirtyRef = useRef(orderDirty);

    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [storeProducts, setStoreProducts] = useState([]);
    const [storePlatforms, setStorePlatforms] = useState([]);
    const [storeLoading, setStoreLoading] = useState(false);
    const [storeSearch, setStoreSearch] = useState('');
    const [storePlatformToAddId, setStorePlatformToAddId] = useState('');
    const [storeEdits, setStoreEdits] = useState({});
    const [storeSavingId, setStoreSavingId] = useState(null);
    const defaultStoreCreateForm = {
        name: '',
        slug: '',
        description: '',
        product_type: 'acesso',
        monthly: '',
        trimestral: '',
        semestral: '',
        anual: '',
        is_active: true,
    };
    const [storeCreateForm, setStoreCreateForm] = useState(defaultStoreCreateForm);
    const [storeCreating, setStoreCreating] = useState(false);

    const defaultSupportForm = {
        email_title: 'E-mail de Suporte',
        email_value: 'contato@concursaflix.com',
        email_button_text: 'Entrar em Contato',
        email_url: 'mailto:contato@concursaflix.com',
        whatsapp_title: 'WhatsApp',
        whatsapp_value: '55 16 99885-9608',
        whatsapp_button_text: 'Entrar em Contato',
        whatsapp_url: 'https://wa.me/5516998859608',
    };
    const [supportForm, setSupportForm] = useState(defaultSupportForm);
    const [supportLoading, setSupportLoading] = useState(false);
    const [supportSaving, setSupportSaving] = useState(false);

    const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
    const [platformEditingId, setPlatformEditingId] = useState(null);
    const [platformForm, setPlatformForm] = useState({
        name: '',
        description: '',
        image_url: '',
        extension_link: '',
        status: 'active',
        is_visible: true,
        show_account_badge: false,
        account_badge_count: '',
    });

    const [isAccountsModalOpen, setIsAccountsModalOpen] = useState(false);
    const [accountsPlatform, setAccountsPlatform] = useState(null);
    const [platformAccounts, setPlatformAccounts] = useState([]);
    const [platformAccountsLoading, setPlatformAccountsLoading] = useState(false);
    const [platformAccountSeatCounts, setPlatformAccountSeatCounts] = useState({});
    const [accountEditingId, setAccountEditingId] = useState(null);
    const [accountForm, setAccountForm] = useState({
        label: '',
        access_email: '',
        access_password: '',
        extension_link: '',
        status: 'active',
        max_seats: '',
        notes: '',
    });

    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [userForm, setUserForm] = useState({
        full_name: '',
        whatsapp: '',
        role: 'student',
        subscription_status: 'teste-gratis',
        can_access_store: false,
    });

    const [allPlatforms, setAllPlatforms] = useState([]);
    const [availableAccounts, setAvailableAccounts] = useState([]);
    const [userAssignments, setUserAssignments] = useState([]);
    const [userAccessLoading, setUserAccessLoading] = useState(false);
    const [grantForm, setGrantForm] = useState({
        platform_id: '',
        account_id: '',
        valid_from: '',
        valid_until: '',
        note: '',
        show_to_user: true,
        display_order: 0,
    });

    const [editingEntitlementId, setEditingEntitlementId] = useState(null);
    const [entitlementEditForm, setEntitlementEditForm] = useState({
        account_id: '',
        valid_from: '',
        valid_until: '',
        note: '',
        show_to_user: true,
        display_order: 0,
        platform_id: '',
    });

    useEffect(() => {
        coursesRef.current = courses;
    }, [courses]);

    useEffect(() => {
        orderDirtyRef.current = orderDirty;
    }, [orderDirty]);

    useEffect(() => {
        if (activeTab === 'courses') fetchCourses();
        if (activeTab === 'users') fetchUsers();
        if (activeTab === 'store') fetchStoreProducts();
        if (activeTab === 'support') fetchSupportSettings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    function centsToInput(value) {
        const cents = Number(value || 0);
        if (!Number.isFinite(cents) || cents <= 0) return '';
        return (cents / 100).toFixed(2);
    }

    function inputToCents(value) {
        const normalized = String(value || '').replace(',', '.').trim();
        if (!normalized) return 0;
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return Math.round(parsed * 100);
    }

    function normalizeStoreSlug(value) {
        return (value || '')
            .toLowerCase()
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getPlanCents(metadata, cycle) {
        const plans = Array.isArray(metadata?.plans) ? metadata.plans : [];
        const found = plans.find((item) => (item?.cycle || '').toLowerCase() === cycle.toLowerCase());
        return Number(found?.price_cents || 0);
    }

    function createStoreEditFromProduct(product) {
        return {
            is_active: !!product.is_active,
            sort_order: String(product?.sort_order ?? ''),
            monthly: centsToInput(product?.metadata?.price_monthly_cents),
            trimestral: centsToInput(getPlanCents(product?.metadata, 'trimestral')),
            semestral: centsToInput(getPlanCents(product?.metadata, 'semestral')),
            anual: centsToInput(getPlanCents(product?.metadata, 'anual')),
        };
    }

    function isStoreRemoved(product) {
        return Boolean(product?.metadata?.removed_from_store);
    }

    function upsertPlanCycle(plans, cycle, priceCents) {
        const next = Array.isArray(plans) ? [...plans] : [];
        const idx = next.findIndex((item) => (item?.cycle || '').toLowerCase() === cycle.toLowerCase());

        if (!priceCents || priceCents <= 0) {
            if (idx >= 0) next.splice(idx, 1);
            return next;
        }

        const payload = { cycle, price_cents: priceCents };
        if (idx >= 0) next[idx] = payload;
        else next.push(payload);
        return next;
    }

    async function fetchStoreProducts() {
        setStoreLoading(true);
        const [
            { data: productsData, error: productsError },
            { data: platformsData, error: platformsError },
        ] = await Promise.all([
            supabase
                .from('store_products')
                .select('id, slug, name, description, product_type, is_active, is_visible, sort_order, metadata, created_at')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true }),
            supabase
                .from('platforms')
                .select('id, name, description, image_url, status, sort_order, created_at')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true }),
        ]);

        if (productsError || platformsError) {
            alert('Erro ao carregar loja/plataformas: ' + (productsError?.message || platformsError?.message));
            setStoreProducts([]);
            setStorePlatforms([]);
            setStoreLoading(false);
            return;
        }

        const rows = productsData || [];
        const platforms = platformsData || [];
        setStorePlatforms(platforms);

        setStoreProducts(rows);

        const edits = rows.reduce((acc, item) => {
            acc[item.id] = createStoreEditFromProduct(item);
            return acc;
        }, {});
        setStoreEdits(edits);
        setStoreLoading(false);
    }

    async function addPlatformToStore(platform, options = {}) {
        if (!platform?.id) return;
        const { markAsStreaming = false } = options;

        const existing = storeProducts.find((item) => item?.metadata?.platform_id === platform.id)
            || storeProducts.find((item) => normalizeStoreSlug(item?.name) === normalizeStoreSlug(platform.name));

        if (existing?.id) {
            const nextMetadata = {
                ...(existing.metadata || {}),
                platform_id: platform.id,
            };
            if (markAsStreaming) nextMetadata.is_streaming = true;
            delete nextMetadata.removed_from_store;

            const { error } = await supabase
                .from('store_products')
                .update({
                    name: platform.name,
                    slug: normalizeStoreSlug(platform.name) || existing.slug,
                    description: platform.description || existing.description || null,
                    is_active: true,
                    is_visible: true,
                    metadata: nextMetadata,
                })
                .eq('id', existing.id);

            if (error) {
                alert('Erro ao adicionar plataforma na loja: ' + error.message);
                return;
            }

            await fetchStoreProducts();
            return;
        }

        const maxSort = storeProducts.reduce((acc, item) => Math.max(acc, Number(item.sort_order || 0)), 0);
        const { error } = await supabase
            .from('store_products')
            .insert({
                slug: normalizeStoreSlug(platform.name) || `acesso-${String(platform.id).slice(0, 8)}`,
                name: platform.name,
                description: platform.description || null,
                product_type: 'acesso',
                credit_cost: 0,
                allow_multiple_units: true,
                is_highlight: false,
                is_active: true,
                is_visible: true,
                sort_order: maxSort + 10,
                metadata: {
                    platform_id: platform.id,
                    price_monthly_cents: 0,
                    ...(markAsStreaming ? { is_streaming: true } : {}),
                },
            });

        if (error) {
            alert('Erro ao criar produto da plataforma na loja: ' + error.message);
            return;
        }

        await fetchStoreProducts();
    }

    async function saveStoreProduct(product) {
        const edit = storeEdits[product.id];
        if (!edit) return;

        const parsedSortOrder = String(edit.sort_order ?? '').trim() === ''
            ? Number(product?.sort_order || 0)
            : Number(edit.sort_order);

        if (!Number.isFinite(parsedSortOrder) || parsedSortOrder < 0) {
            alert('Ordem inválida. Informe um número maior ou igual a zero.');
            return;
        }

        const monthlyCents = inputToCents(edit.monthly);
        const trimestralCents = inputToCents(edit.trimestral);
        const semestralCents = inputToCents(edit.semestral);
        const anualCents = inputToCents(edit.anual);

        if ([monthlyCents, trimestralCents, semestralCents, anualCents].some((value) => value === null)) {
            alert('Preencha os valores com formato numérico válido (ex: 39.90).');
            return;
        }

        const metadataBase = { ...(product.metadata || {}) };
        metadataBase.price_monthly_cents = monthlyCents;

        let nextPlans = upsertPlanCycle(metadataBase.plans, 'trimestral', trimestralCents);
        nextPlans = upsertPlanCycle(nextPlans, 'semestral', semestralCents);
        nextPlans = upsertPlanCycle(nextPlans, 'anual', anualCents);

        if (nextPlans.length) metadataBase.plans = nextPlans;
        else delete metadataBase.plans;

        setStoreSavingId(product.id);
        const { error } = await supabase
            .from('store_products')
            .update({
                is_active: !!edit.is_active,
                sort_order: Math.round(parsedSortOrder),
                metadata: metadataBase,
            })
            .eq('id', product.id);

        setStoreSavingId(null);

        if (error) {
            alert('Erro ao salvar produto da loja: ' + error.message);
            return;
        }

        await fetchStoreProducts();
    }

    async function deleteStoreProduct(product) {
        if (!product?.id) return;
        const isPlatformLinked = !!product?.metadata?.platform_id;
        if (!confirm(`Remover "${product.name}" da loja? ${isPlatformLinked ? 'A plataforma continuará cadastrada normalmente.' : 'Esta ação exclui o item da lista.'}`)) return;

        const nextMetadata = {
            ...(product.metadata || {}),
            removed_from_store: true,
        };

        const { error } = await supabase
            .from('store_products')
            .update({
                is_active: false,
                is_visible: false,
                metadata: nextMetadata,
            })
            .eq('id', product.id);

        if (error) {
            alert('Erro ao excluir produto da loja: ' + error.message);
            return;
        }

        await fetchStoreProducts();
    }

    async function reactivateStoreProduct(product) {
        if (!product?.id) return;

        const nextMetadata = {
            ...(product.metadata || {}),
        };
        delete nextMetadata.removed_from_store;

        const { error } = await supabase
            .from('store_products')
            .update({
                is_active: true,
                is_visible: true,
                metadata: nextMetadata,
            })
            .eq('id', product.id);

        if (error) {
            alert('Erro ao reativar item da loja: ' + error.message);
            return;
        }

        await fetchStoreProducts();
    }

    async function createStoreProduct() {
        const name = (storeCreateForm.name || '').trim();
        if (!name) {
            alert('Informe o nome do produto.');
            return;
        }

        const slug = normalizeStoreSlug(storeCreateForm.slug || name);
        if (!slug) {
            alert('Informe um slug válido.');
            return;
        }

        const monthlyCents = inputToCents(storeCreateForm.monthly);
        const trimestralCents = inputToCents(storeCreateForm.trimestral);
        const semestralCents = inputToCents(storeCreateForm.semestral);
        const anualCents = inputToCents(storeCreateForm.anual);

        if ([monthlyCents, trimestralCents, semestralCents, anualCents].some((value) => value === null)) {
            alert('Preencha os valores com formato numérico válido (ex: 39.90).');
            return;
        }

        let plans = [];
        plans = upsertPlanCycle(plans, 'trimestral', trimestralCents);
        plans = upsertPlanCycle(plans, 'semestral', semestralCents);
        plans = upsertPlanCycle(plans, 'anual', anualCents);

        const metadata = {
            price_monthly_cents: monthlyCents || 0,
        };

        if (plans.length) metadata.plans = plans;

        const maxSort = storeProducts.reduce((acc, item) => Math.max(acc, Number(item.sort_order || 0)), 0);

        setStoreCreating(true);
        const { error } = await supabase
            .from('store_products')
            .insert({
                slug,
                name,
                description: (storeCreateForm.description || '').trim() || null,
                product_type: storeCreateForm.product_type || 'acesso',
                credit_cost: 0,
                allow_multiple_units: true,
                is_highlight: false,
                is_active: !!storeCreateForm.is_active,
                is_visible: true,
                sort_order: maxSort + 10,
                metadata,
            });
        setStoreCreating(false);

        if (error) {
            alert('Erro ao criar produto da loja: ' + error.message);
            return;
        }

        setStoreCreateForm(defaultStoreCreateForm);
        await fetchStoreProducts();
    }

    const filteredStoreProducts = useMemo(() => {
        const query = storeSearch.trim().toLowerCase();
        if (!query) return storeProducts;
        return storeProducts.filter((item) =>
            (item.name || '').toLowerCase().includes(query)
            || (item.slug || '').toLowerCase().includes(query)
            || (item.product_type || '').toLowerCase().includes(query)
        );
    }, [storeProducts, storeSearch]);

    const storePlatformRows = useMemo(() => {
        return storePlatforms.map((platform) => {
            const linkedByPlatformId = storeProducts.filter((item) => item?.metadata?.platform_id === platform.id);

            const linkedByNameFallback = linkedByPlatformId.length
                ? []
                : storeProducts.filter((item) => {
                    if (!item) return false;
                    if (item?.metadata?.platform_id) return false;
                    return normalizeStoreSlug(item.name) === normalizeStoreSlug(platform.name);
                });

            const linkedProducts = [...linkedByPlatformId, ...linkedByNameFallback];

            const activeProduct = linkedProducts.find((item) => !isStoreRemoved(item) && !!item.is_active && item.is_visible !== false) || null;
            const disabledProduct = linkedProducts.find((item) => isStoreRemoved(item) || !item.is_active || item.is_visible === false) || null;

            return {
                platform,
                product: activeProduct,
                disabledProduct,
            };
        });
    }, [storePlatforms, storeProducts]);

    const filteredStorePlatformRows = useMemo(() => {
        const query = storeSearch.trim().toLowerCase();
        if (!query) return storePlatformRows;
        return storePlatformRows.filter(({ platform, product, disabledProduct }) =>
            (platform.name || '').toLowerCase().includes(query)
            || (product?.slug || '').toLowerCase().includes(query)
            || (product?.name || '').toLowerCase().includes(query)
            || (disabledProduct?.slug || '').toLowerCase().includes(query)
            || (disabledProduct?.name || '').toLowerCase().includes(query)
        );
    }, [storePlatformRows, storeSearch]);

    const activeStorePlatformRows = useMemo(
        () => filteredStorePlatformRows.filter(({ product }) => !!product),
        [filteredStorePlatformRows]
    );

    const inactiveStorePlatformRows = useMemo(
        () => filteredStorePlatformRows.filter(({ product }) => !product),
        [filteredStorePlatformRows]
    );

    const filteredStreamingPlatforms = useMemo(() => {
        const query = storeSearch.trim().toLowerCase();
        if (!query) return storePlatforms;
        return storePlatforms.filter((platform) =>
            (platform.name || '').toLowerCase().includes(query)
            || (platform.status || '').toLowerCase().includes(query)
        );
    }, [storePlatforms, storeSearch]);

    const storePlatformRowById = useMemo(() => {
        const map = new Map();
        storePlatformRows.forEach((row) => {
            if (row?.platform?.id) map.set(row.platform.id, row);
        });
        return map;
    }, [storePlatformRows]);

    const filteredStreamingOnlyRows = useMemo(() => {
        const query = storeSearch.trim().toLowerCase();

        const rows = storePlatformRows.filter(({ platform, product, disabledProduct }) => {
            const streamingProduct = product || disabledProduct;
            if (!streamingProduct) return false;
            return isStreamingStoreItem(streamingProduct, platform);
        });

        if (!query) return rows;
        return rows.filter(({ platform, product, disabledProduct }) => {
            const streamingProduct = product || disabledProduct;
            return (
            (platform?.name || '').toLowerCase().includes(query)
            || (streamingProduct?.slug || '').toLowerCase().includes(query)
            || (streamingProduct?.name || '').toLowerCase().includes(query)
            );
        });
    }, [storePlatformRows, storeSearch]);

    const streamingAddOptions = useMemo(() => {
        return filteredStreamingPlatforms.filter((platform) => {
            const row = storePlatformRowById.get(platform.id);
            const streamingProduct = row?.product || row?.disabledProduct;
            return !isStreamingStoreItem(streamingProduct, platform);
        });
    }, [filteredStreamingPlatforms, storePlatformRowById]);

    async function fetchSupportSettings() {
        setSupportLoading(true);
        const { data, error } = await supabase
            .from('support_settings')
            .select('email_title, email_value, email_button_text, email_url, whatsapp_title, whatsapp_value, whatsapp_button_text, whatsapp_url')
            .eq('id', true)
            .maybeSingle();

        if (!error && data) {
            setSupportForm({ ...defaultSupportForm, ...data });
        } else {
            setSupportForm(defaultSupportForm);
        }
        setSupportLoading(false);
    }

    async function saveSupportSettings() {
        setSupportSaving(true);
        const payload = {
            id: true,
            ...supportForm,
        };

        const { error } = await supabase
            .from('support_settings')
            .upsert(payload, { onConflict: 'id' });

        if (error) {
            alert('Erro ao salvar suporte: ' + error.message);
        } else {
            alert('Configurações de suporte salvas com sucesso.');
        }
        setSupportSaving(false);
    }

    async function fetchCourses() {
        setCoursesLoading(true);
        let result = await supabase
            .from('platforms')
            .select('id, name, description, image_url, sort_order, status, is_visible, extension_link, show_account_badge, account_badge_count, created_at')
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false });

        if (result.error && String(result.error.message || '').toLowerCase().includes('is_visible')) {
            result = await supabase
                .from('platforms')
                .select('id, name, description, image_url, sort_order, status, extension_link, show_account_badge, account_badge_count, created_at')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: false });
        }

        if (!result.error) {
            const rows = (result.data || []).map((item) => ({
                ...item,
                is_visible: item?.is_visible !== false,
            }));
            setCourses(rows);
        }
        setCoursesLoading(false);
    }

    async function movePlatform(platformId, direction) {
        const list = filteredCourses.slice();
        const fromIndex = list.findIndex((p) => p.id === platformId);
        if (fromIndex < 0) return;
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= list.length) return;

        const tmp = list[fromIndex];
        list[fromIndex] = list[toIndex];
        list[toIndex] = tmp;

        // Update only existing rows (avoids upsert accidentally trying an insert with missing NOT NULL fields)
        const updates = list
            .map((p, idx) => ({ id: p.id, sort_order: (idx + 1) * 10 }))
            .filter((p) => !!p.id);

        for (const u of updates) {
            const { error } = await supabase
                .from('platforms')
                .update({ sort_order: u.sort_order })
                .eq('id', u.id);
            if (error) return alert('Erro ao reordenar: ' + error.message);
        }
        await fetchCourses();
    }

    async function persistPlatformOrder(orderedCourses) {
        if (!Array.isArray(orderedCourses) || orderedCourses.length === 0) return;

        setReorderSaving(true);
        try {
            const updates = orderedCourses
                .map((p, idx) => ({ id: p.id, sort_order: (idx + 1) * 10 }))
                .filter((p) => !!p.id);

            for (const u of updates) {
                const { error } = await supabase
                    .from('platforms')
                    .update({ sort_order: u.sort_order })
                    .eq('id', u.id);
                if (error) throw error;
            }

            setOrderDirty(false);
        } catch (error) {
            alert('Erro ao reordenar: ' + (error?.message || String(error)));
        } finally {
            setReorderSaving(false);
            await fetchCourses();
        }
    }

    function nowIsoNoMs() {
        return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    async function fetchPlatformAccounts(platformId) {
        setPlatformAccountsLoading(true);
        setPlatformAccountSeatCounts({});
        const { data, error } = await supabase
            .from('platform_accounts')
            .select('id, label, access_email, access_password, extension_link, status, max_seats, notes, created_at')
            .eq('platform_id', platformId)
            .order('created_at', { ascending: false });
        if (!error) setPlatformAccounts(data || []);

        const accountIds = (data || []).map((a) => a.id);
        if (accountIds.length === 0) {
            setPlatformAccountsLoading(false);
            return;
        }

        const nowIso = nowIsoNoMs();
        const activeAssignments = await supabase
            .from('platform_account_assignments')
            .select('account_id')
            .is('revoked_at', null)
            .lte('valid_from', nowIso)
            .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
            .in('account_id', accountIds);

        if (!activeAssignments.error) {
            const counts = {};
            for (const row of (activeAssignments.data || [])) {
                counts[row.account_id] = (counts[row.account_id] || 0) + 1;
            }
            setPlatformAccountSeatCounts(counts);
        }

        setPlatformAccountsLoading(false);
    }

    function openManageAccounts(platform) {
        setAccountsPlatform(platform);
        setAccountEditingId(null);
        setAccountForm({
            label: '',
            access_email: '',
            access_password: '',
            extension_link: platform?.extension_link ?? '',
            status: 'active',
            max_seats: '',
            notes: '',
        });
        setIsAccountsModalOpen(true);
        fetchPlatformAccounts(platform.id);
    }

    function openEditAccount(acc) {
        setAccountEditingId(acc.id);
        setAccountForm({
            label: acc.label ?? '',
            access_email: acc.access_email ?? '',
            access_password: acc.access_password ?? '',
            extension_link: acc.extension_link ?? (accountsPlatform?.extension_link ?? ''),
            status: acc.status ?? 'active',
            max_seats: acc.max_seats ?? '',
            notes: acc.notes ?? '',
        });
    }

    async function saveAccount() {
        if (!accountsPlatform?.id) return;
        if (!accountForm.label) return alert('Defina um rótulo (ex: Conta 1)');

        const payload = {
            platform_id: accountsPlatform.id,
            label: accountForm.label,
            access_email: accountForm.access_email || null,
            access_password: accountForm.access_password || null,
            extension_link: accountForm.extension_link || null,
            status: accountForm.status || 'active',
            max_seats: accountForm.max_seats === '' ? null : Number(accountForm.max_seats),
            notes: accountForm.notes || null,
        };

        const { error } = accountEditingId
            ? await supabase.from('platform_accounts').update(payload).eq('id', accountEditingId)
            : await supabase.from('platform_accounts').insert([payload]);

        if (error) return alert('Erro ao salvar conta: ' + error.message);

        setAccountEditingId(null);
        setAccountForm({
            label: '',
            access_email: '',
            access_password: '',
            extension_link: accountsPlatform?.extension_link ?? '',
            status: 'active',
            max_seats: '',
            notes: '',
        });
        await fetchPlatformAccounts(accountsPlatform.id);
    }

    async function deleteAccount(accountId) {
        if (!confirm('Excluir esta conta?')) return;
        const { error } = await supabase.from('platform_accounts').delete().eq('id', accountId);
        if (error) return alert('Erro ao excluir conta: ' + error.message);
        await fetchPlatformAccounts(accountsPlatform.id);
    }

    async function fetchAllPlatforms() {
        const [storeProductsResult, platformsResult] = await Promise.all([
            supabase
                .from('store_products')
                .select('metadata, is_active, is_visible')
                .eq('is_active', true)
                .eq('is_visible', true),
            supabase
                .from('platforms')
                .select('id, name, status, image_url, sort_order, created_at')
                .eq('status', 'active')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: false }),
        ]);

        if (!storeProductsResult.error && !platformsResult.error) {
            const activeStorePlatformIds = new Set(
                (storeProductsResult.data || [])
                    .map((item) => item?.metadata?.platform_id)
                    .filter(Boolean)
            );

            const filtered = (platformsResult.data || []).filter((platform) => activeStorePlatformIds.has(platform.id));
            setAllPlatforms(filtered);
            return;
        }

        console.error('Erro ao carregar plataformas da loja para concessão:', storeProductsResult.error || platformsResult.error);
        setAllPlatforms([]);
    }

    async function fetchUsers() {
        setUsersLoading(true);
        let result = await supabase
            .from('profiles')
            .select('id, email, full_name, whatsapp, role, subscription_status, can_access_store, created_at')
            .order('created_at', { ascending: false });

        if (result.error && String(result.error.message || '').toLowerCase().includes('can_access_store')) {
            result = await supabase
                .from('profiles')
                .select('id, email, full_name, whatsapp, role, subscription_status, created_at')
                .order('created_at', { ascending: false });
            if (!result.error) {
                result.data = (result.data || []).map((item) => ({ ...item, can_access_store: false }));
            }
        }

        if (!result.error) setUsers(result.data || []);
        setUsersLoading(false);
    }

    function openCreatePlatform() {
        setPlatformEditingId(null);
        setPlatformForm({
            name: '',
            description: '',
            image_url: '',
            extension_link: '',
            status: 'active',
            is_visible: true,
            show_account_badge: false,
            account_badge_count: '',
        });
        setIsPlatformModalOpen(true);
    }

    function openEditPlatform(platform) {
        setPlatformEditingId(platform.id);
        setPlatformForm({
            name: platform.name ?? '',
            description: platform.description ?? '',
            image_url: platform.image_url ?? '',
            extension_link: platform.extension_link ?? '',
            status: platform.status ?? 'active',
            is_visible: platform.is_visible !== false,
            show_account_badge: !!platform.show_account_badge,
            account_badge_count: platform.account_badge_count == null ? '' : String(platform.account_badge_count),
        });
        setIsPlatformModalOpen(true);
    }

    async function savePlatform() {
        if (!platformForm.name) return;

        const payload = {
            name: platformForm.name,
            description: platformForm.description,
            image_url: platformForm.image_url,
            extension_link: platformForm.extension_link,
            status: platformForm.status || 'active',
            is_visible: platformForm.is_visible !== false,
            show_account_badge: !!platformForm.show_account_badge,
            account_badge_count: platformForm.account_badge_count === ''
                ? 0
                : Math.max(0, Number(platformForm.account_badge_count) || 0),
        };

        let { error } = platformEditingId
            ? await supabase.from('platforms').update(payload).eq('id', platformEditingId)
            : await supabase.from('platforms').insert([payload]);

        if (error && String(error.message || '').toLowerCase().includes('is_visible')) {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.is_visible;
            const fallbackResult = platformEditingId
                ? await supabase.from('platforms').update(fallbackPayload).eq('id', platformEditingId)
                : await supabase.from('platforms').insert([fallbackPayload]);
            error = fallbackResult.error;
            if (!error) {
                alert('Plataforma salva, mas a opção "Visível" ainda não está ativa no banco. Execute o SQL setup_platform_visibility.sql.');
            }
        }

        if (error) {
            alert(`Erro ao ${platformEditingId ? 'atualizar' : 'criar'} plataforma: ${error.message}`);
            return;
        }

        setIsPlatformModalOpen(false);
        setPlatformEditingId(null);
        if (activeTab === 'store') {
            await Promise.all([fetchCourses(), fetchStoreProducts()]);
        } else {
            await fetchCourses();
        }
    }

    async function deletePlatform(id) {
        if (!confirm('Tem certeza?')) return;
        const { error } = await supabase.from('platforms').delete().eq('id', id);
        if (error) alert('Erro ao excluir: ' + error.message);
        else fetchCourses();
    }

    function openEditUser(user) {
        setSelectedUser(user);
        setUserForm({
            full_name: user.full_name ?? '',
            whatsapp: user.whatsapp ?? '',
            role: user.role ?? 'student',
            subscription_status: user.subscription_status === 'active' ? 'mensal' : (user.subscription_status ?? 'teste-gratis'),
            can_access_store: user.can_access_store === true,
        });
        loadUserAccess(user.id);
        setIsUserModalOpen(true);
    }

    async function loadUserAccess(userId) {
        setUserAccessLoading(true);
        await fetchAllPlatforms();
        const { data, error } = await supabase
            .from('platform_account_assignments')
            .select('id, account_id, profile_id, valid_from, valid_until, revoked_at, show_to_user, display_order, note, created_at, platform_accounts(id, label, status, platform_id, platforms(id, name))')
            .eq('profile_id', userId)
            .order('created_at', { ascending: false });
        if (!error) setUserAssignments(data || []);

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;
        setGrantForm({
            platform_id: '',
            account_id: '',
            valid_from: todayStr,
            valid_until: '',
            note: '',
            show_to_user: true,
            display_order: 0,
        });
        setAvailableAccounts([]);
        setEditingEntitlementId(null);
        setUserAccessLoading(false);
    }

    async function loadAccountsForPlatform(platformId) {
        if (!platformId) {
            setAvailableAccounts([]);
            return;
        }
        const { data, error } = await supabase
            .from('platform_accounts')
            .select('id, label, status, max_seats')
            .eq('platform_id', platformId)
            .order('created_at', { ascending: false });
        if (!error) setAvailableAccounts(data || []);
    }

    function toIsoDateStart(dateStr) {
        if (!dateStr) return null;
        return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
    }

    function toIsoDateEnd(dateStr) {
        if (!dateStr) return null;
        return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
    }

    async function grantAccess() {
        if (!selectedUser?.id) return;
        if (!grantForm.platform_id) return alert('Selecione uma plataforma');
        if (!grantForm.account_id) return alert('Selecione uma conta');
        if (!grantForm.valid_from) return alert('Defina a data de início');

        const payload = {
            profile_id: selectedUser.id,
            account_id: grantForm.account_id,
            valid_from: toIsoDateStart(grantForm.valid_from),
            valid_until: grantForm.valid_until ? toIsoDateEnd(grantForm.valid_until) : null,
            note: grantForm.note || null,
            show_to_user: !!grantForm.show_to_user,
            display_order: Number(grantForm.display_order) || 0,
        };

        const { error } = await supabase
            .from('platform_account_assignments')
            .insert([payload]);

        if (error) return alert('Erro ao conceder acesso: ' + error.message);
        await loadUserAccess(selectedUser.id);
    }

    function startEditEntitlement(ent) {
        const toDateInput = (iso) => {
            if (!iso) return '';
            const d = new Date(iso);
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };
        setEditingEntitlementId(ent.id);
        setEntitlementEditForm({
            platform_id: ent?.platform_accounts?.platform_id || '',
            account_id: ent.account_id || '',
            valid_from: toDateInput(ent.valid_from),
            valid_until: toDateInput(ent.valid_until),
            note: ent.note || '',
            show_to_user: ent.show_to_user !== false,
            display_order: ent.display_order ?? 0,
        });

        if (ent?.platform_accounts?.platform_id) {
            loadAccountsForPlatform(ent.platform_accounts.platform_id);
        }
    }

    async function saveEntitlementEdit() {
        if (!selectedUser?.id || !editingEntitlementId) return;
        if (!entitlementEditForm.valid_from) return alert('Defina a data de início');

        const payload = {
            account_id: entitlementEditForm.account_id,
            valid_from: toIsoDateStart(entitlementEditForm.valid_from),
            valid_until: entitlementEditForm.valid_until ? toIsoDateEnd(entitlementEditForm.valid_until) : null,
            note: entitlementEditForm.note || null,
            show_to_user: !!entitlementEditForm.show_to_user,
            display_order: Number(entitlementEditForm.display_order) || 0,
        };

        const { error } = await supabase
            .from('platform_account_assignments')
            .update(payload)
            .eq('id', editingEntitlementId);

        if (error) return alert('Erro ao atualizar acesso: ' + error.message);
        setEditingEntitlementId(null);
        await loadUserAccess(selectedUser.id);
    }

    async function revokeEntitlement(entId) {
        if (!selectedUser?.id) return;
        const { error } = await supabase
            .from('platform_account_assignments')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', entId);
        if (error) return alert('Erro ao revogar acesso: ' + error.message);
        await loadUserAccess(selectedUser.id);
    }

    async function saveUser() {
        if (!selectedUser?.id) return;
        let { error } = await supabase
            .from('profiles')
            .update({
                full_name: userForm.full_name,
                whatsapp: userForm.whatsapp,
                role: userForm.role,
                subscription_status: userForm.subscription_status,
                can_access_store: !!userForm.can_access_store,
            })
            .eq('id', selectedUser.id);

        if (error && String(error.message || '').toLowerCase().includes('can_access_store')) {
            const fallback = await supabase
                .from('profiles')
                .update({
                    full_name: userForm.full_name,
                    whatsapp: userForm.whatsapp,
                    role: userForm.role,
                    subscription_status: userForm.subscription_status,
                })
                .eq('id', selectedUser.id);
            error = fallback.error;
            if (!error) {
                alert('Usuário salvo, mas o controle de acesso da loja ainda não está ativo no banco. Execute setup_user_store_access.sql.');
            }
        }

        if (error) {
            alert('Erro ao atualizar usuário: ' + error.message);
            return;
        }

        setIsUserModalOpen(false);
        setSelectedUser(null);
        fetchUsers();
    }

    async function toggleUserRole(user) {
        const next = user.role === 'admin' ? 'student' : 'admin';
        if (!confirm(`Tem certeza que deseja definir este usuário como ${next}?`)) return;
        const { error } = await supabase
            .from('profiles')
            .update({ role: next })
            .eq('id', user.id);
        if (error) alert('Erro ao atualizar role: ' + error.message);
        else fetchUsers();
    }

    const searchQuery = search.trim().toLowerCase();
    const searchDigits = searchQuery.replace(/\D+/g, '');
    const filteredCourses = useMemo(() => {
        if (!searchQuery) return courses;
        return courses.filter((c) => (c.name || '').toLowerCase().includes(searchQuery));
    }, [courses, searchQuery]);

    const filteredUsers = useMemo(() => {
        if (!searchQuery) return users;
        return users.filter((u) =>
            (u.full_name || '').toLowerCase().includes(searchQuery)
            || (u.email || '').toLowerCase().includes(searchQuery)
            || (u.whatsapp || '').toLowerCase().includes(searchQuery)
            || (searchDigits.length > 0 && String(u.whatsapp || '').replace(/\D+/g, '').includes(searchDigits))
        );
    }, [users, searchQuery, searchDigits]);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl font-bold text-white mb-2">Painel Administrativo</h1>
                    <p className="text-gray-400">Gerencie plataformas e usuários.</p>
                </div>
                <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
                    <button
                        onClick={() => setActiveTab('courses')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            activeTab === 'courses' ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"
                        )}
                    >
                        Plataformas
                    </button>
                    <button
                        onClick={() => setActiveTab('users')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            activeTab === 'users' ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"
                        )}
                    >
                        Usuários
                    </button>
                    <button
                        onClick={() => setActiveTab('plans')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            activeTab === 'plans' ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"
                        )}
                    >
                        Planos
                    </button>
                    <button
                        onClick={() => setActiveTab('store')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            activeTab === 'store' ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"
                        )}
                    >
                        Loja
                    </button>
                    <button
                        onClick={() => setActiveTab('support')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            activeTab === 'support' ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"
                        )}
                    >
                        Suporte
                    </button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-primary/20 to-transparent border-primary/20">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-400">Total de Usuários</p>
                            <p className="text-3xl font-bold text-white">{users.length || '—'}</p>
                        </div>
                        <Users className="h-8 w-8 text-primary" />
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-500/20 to-transparent border-blue-500/20">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-400">Plataformas</p>
                            <p className="text-3xl font-bold text-white">{courses.length || '—'}</p>
                        </div>
                        <Layers className="h-8 w-8 text-blue-500" />
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-500/20 to-transparent border-green-500/20">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-400">Receita Mensal</p>
                            <p className="text-3xl font-bold text-white">R$ 45k</p>
                        </div>
                        <div className="h-8 w-8 text-green-500 font-bold flex items-center justify-center">$</div>
                    </CardContent>
                </Card>
            </div>

            {activeTab === 'support' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-primary" /> Configuração de Suporte
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {supportLoading ? (
                            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                        ) : (
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-gray-300">Card de E-mail</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <Input
                                            value={supportForm.email_title}
                                            onChange={(e) => setSupportForm({ ...supportForm, email_title: e.target.value })}
                                            placeholder="Título"
                                        />
                                        <Input
                                            value={supportForm.email_value}
                                            onChange={(e) => setSupportForm({ ...supportForm, email_value: e.target.value })}
                                            placeholder="Valor exibido"
                                        />
                                        <Input
                                            value={supportForm.email_button_text}
                                            onChange={(e) => setSupportForm({ ...supportForm, email_button_text: e.target.value })}
                                            placeholder="Texto do botão"
                                        />
                                        <Input
                                            value={supportForm.email_url}
                                            onChange={(e) => setSupportForm({ ...supportForm, email_url: e.target.value })}
                                            placeholder="URL (ex: mailto:contato@...)"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-gray-300">Card de WhatsApp</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <Input
                                            value={supportForm.whatsapp_title}
                                            onChange={(e) => setSupportForm({ ...supportForm, whatsapp_title: e.target.value })}
                                            placeholder="Título"
                                        />
                                        <Input
                                            value={supportForm.whatsapp_value}
                                            onChange={(e) => setSupportForm({ ...supportForm, whatsapp_value: e.target.value })}
                                            placeholder="Valor exibido"
                                        />
                                        <Input
                                            value={supportForm.whatsapp_button_text}
                                            onChange={(e) => setSupportForm({ ...supportForm, whatsapp_button_text: e.target.value })}
                                            placeholder="Texto do botão"
                                        />
                                        <Input
                                            value={supportForm.whatsapp_url}
                                            onChange={(e) => setSupportForm({ ...supportForm, whatsapp_url: e.target.value })}
                                            placeholder="URL (ex: https://wa.me/...)"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end">
                                    <Button onClick={saveSupportSettings} disabled={supportSaving}>
                                        {supportSaving ? 'Salvando...' : 'Salvar configurações'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeTab === 'plans' && <PlansSettingsPanel />}

            {activeTab === 'store' && (
                <Card>
                    <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-primary" /> Configuração da Loja
                        </CardTitle>
                        <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
                            <Button type="button" variant="ghost" onClick={openCreatePlatform}>
                                <Plus className="mr-2 h-4 w-4" /> Adicionar plataforma (Streaming)
                            </Button>
                            <div className="relative w-full sm:w-[320px]">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                                <Input
                                    placeholder="Buscar produto, slug ou tipo..."
                                    className="pl-9"
                                    value={storeSearch}
                                    onChange={(e) => setStoreSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4 space-y-4">
                            <h3 className="text-sm font-semibold text-white">Adicionar novo produto</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Input
                                    placeholder="Nome do produto"
                                    value={storeCreateForm.name}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                                />
                                <Input
                                    placeholder="Slug (opcional)"
                                    value={storeCreateForm.slug}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, slug: e.target.value }))}
                                />
                                <Input
                                    placeholder="Descrição (opcional)"
                                    value={storeCreateForm.description}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                                />
                                <select
                                    value={storeCreateForm.product_type}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, product_type: e.target.value }))}
                                    className="h-11 rounded-xl border border-white/10 bg-[#141414] px-3 text-sm text-white"
                                >
                                    <option value="acesso">acesso</option>
                                    <option value="combo">combo</option>
                                    <option value="plano_personalizado">plano_personalizado</option>
                                </select>
                                <Input
                                    placeholder="Mensal (R$)"
                                    value={storeCreateForm.monthly}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, monthly: e.target.value }))}
                                />
                                <Input
                                    placeholder="Trimestral (R$)"
                                    value={storeCreateForm.trimestral}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, trimestral: e.target.value }))}
                                />
                                <Input
                                    placeholder="Semestral (R$)"
                                    value={storeCreateForm.semestral}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, semestral: e.target.value }))}
                                />
                                <Input
                                    placeholder="Anual (R$)"
                                    value={storeCreateForm.anual}
                                    onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, anual: e.target.value }))}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={!!storeCreateForm.is_active}
                                        onChange={(e) => setStoreCreateForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                                    />
                                    Produto ativo
                                </label>
                                <Button onClick={createStoreProduct} disabled={storeCreating}>
                                    {storeCreating ? 'Adicionando...' : 'Adicionar produto'}
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200 mb-4">
                            Ao excluir um item, ele sai da loja e não aparece para o usuário final. Para voltar, use o botão “Adicionar”.
                        </div>

                        <h4 className="text-sm font-semibold text-white mb-3">Streamings (somente os que estão no Streaming)</h4>
                        <div className="relative overflow-x-auto rounded-xl border border-white/5 mb-6">
                            {storeLoading ? (
                                <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                <table className="w-full text-left text-sm text-gray-300">
                                    <thead className="bg-white/5 text-xs uppercase text-gray-300">
                                        <tr>
                                            <th className="px-4 py-3">Streaming</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Loja</th>
                                            <th className="px-3 py-3 min-w-[110px]">Mensal</th>
                                            <th className="px-3 py-3 min-w-[110px]">Trimestral</th>
                                            <th className="px-3 py-3 min-w-[110px]">Semestral</th>
                                            <th className="px-3 py-3 min-w-[110px]">Anual</th>
                                            <th className="px-4 py-3 text-right">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredStreamingOnlyRows.map(({ platform, product, disabledProduct }) => {
                                            const streamingProduct = product || disabledProduct;
                                            const edit = streamingProduct ? (storeEdits[streamingProduct.id] || {}) : {};
                                            const saving = streamingProduct ? storeSavingId === streamingProduct.id : false;
                                            const isActiveInStore = !!product;

                                            return (
                                                <tr key={`streaming-${platform.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors align-top">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            {platform.image_url ? (
                                                                <img src={platform.image_url} className="hidden sm:block w-8 h-8 rounded object-cover" />
                                                            ) : null}
                                                            <div className="min-w-0">
                                                                <div className="font-medium text-white truncate">{platform.name}</div>
                                                                <div className="text-xs text-gray-500 truncate">{platform.status || 'active'}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="rounded-full px-2 py-1 text-xs bg-white/10 text-gray-200">
                                                            {(platform.status || 'active') === 'active' ? 'Ativo' : 'Inativo'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`text-xs ${isActiveInStore ? 'text-green-300' : 'text-yellow-300'}`}>
                                                            {isActiveInStore ? 'Ativo no Streaming' : 'Desativado no Streaming'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.monthly ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [streamingProduct?.id]: { ...prev[streamingProduct?.id], monthly: e.target.value },
                                                            }))}
                                                            placeholder="39.90"
                                                            disabled={!streamingProduct}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.trimestral ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [streamingProduct?.id]: { ...prev[streamingProduct?.id], trimestral: e.target.value },
                                                            }))}
                                                            placeholder="99.90"
                                                            disabled={!streamingProduct}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.semestral ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [streamingProduct?.id]: { ...prev[streamingProduct?.id], semestral: e.target.value },
                                                            }))}
                                                            placeholder="179.90"
                                                            disabled={!streamingProduct}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.anual ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [streamingProduct?.id]: { ...prev[streamingProduct?.id], anual: e.target.value },
                                                            }))}
                                                            placeholder="299.90"
                                                            disabled={!streamingProduct}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Button size="sm" variant="ghost" onClick={() => openEditPlatform(platform)}>
                                                                Editar
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => streamingProduct && saveStoreProduct(streamingProduct)}
                                                                disabled={!streamingProduct || saving}
                                                            >
                                                                {saving ? 'Salvando...' : 'Salvar planos'}
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!filteredStreamingOnlyRows.length && (
                                            <tr>
                                                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                                                    Nenhum item está no Streaming para essa busca.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        <h4 className="text-sm font-semibold text-white mb-3">Adicionar no Streaming</h4>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6 space-y-3">
                            <select
                                value={storePlatformToAddId}
                                onChange={(e) => setStorePlatformToAddId(e.target.value)}
                                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                                style={{ colorScheme: 'dark' }}
                            >
                                <option value="" className="bg-neutral-900 text-white">Selecione…</option>
                                {streamingAddOptions.map((platform) => (
                                    <option key={platform.id} value={platform.id} className="bg-neutral-900 text-white">
                                        {platform.name}
                                    </option>
                                ))}
                            </select>

                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    disabled={!storePlatformToAddId}
                                    onClick={() => {
                                        const selected = storePlatforms.find((p) => p.id === storePlatformToAddId);
                                        if (!selected) return;
                                        addPlatformToStore(selected, { markAsStreaming: true });
                                        setStorePlatformToAddId('');
                                    }}
                                >
                                    Adicionar no Streaming
                                </Button>
                            </div>

                            {!streamingAddOptions.length ? (
                                <p className="text-xs text-gray-400">Todas as plataformas desta busca já estão no Streaming.</p>
                            ) : null}
                        </div>

                        <h4 className="text-sm font-semibold text-white mb-3">Ativos na loja</h4>
                        <div className="relative overflow-x-auto rounded-xl border border-white/5">
                            {storeLoading ? (
                                <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                <table className="w-full text-left text-sm text-gray-300">
                                    <thead className="bg-white/5 text-xs uppercase text-gray-300">
                                        <tr>
                                            <th className="px-4 py-3">Produto</th>
                                            <th className="px-4 py-3">Tipo</th>
                                            <th className="px-3 py-3 min-w-[120px]">Mensal</th>
                                            <th className="px-3 py-3 min-w-[120px]">Trimestral</th>
                                            <th className="px-3 py-3 min-w-[120px]">Semestral</th>
                                            <th className="px-3 py-3 min-w-[120px]">Anual</th>
                                            <th className="px-3 py-3 text-center">Ativo</th>
                                            <th className="px-4 py-3 text-right">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeStorePlatformRows.map(({ platform, product }) => {
                                            const edit = product ? (storeEdits[product.id] || {}) : {};
                                            const saving = product ? storeSavingId === product.id : false;

                                            return (
                                                <tr key={platform.id} className="border-b border-white/5 hover:bg-white/5 transition-colors align-top">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            {platform.image_url ? (
                                                                <img src={platform.image_url} className="hidden sm:block w-8 h-8 rounded object-cover" />
                                                            ) : null}
                                                            <div className="min-w-0">
                                                                <div className="font-medium text-white truncate">{platform.name}</div>
                                                                <div className="text-xs text-gray-500 truncate">{product?.slug || 'sem produto vinculado'}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="rounded-full px-2 py-1 text-xs bg-white/10 text-gray-200">
                                                            {product?.product_type || 'acesso'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.monthly ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [product?.id]: { ...prev[product?.id], monthly: e.target.value },
                                                            }))}
                                                            placeholder="39.90"
                                                            disabled={!product}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.trimestral ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [product?.id]: { ...prev[product?.id], trimestral: e.target.value },
                                                            }))}
                                                            placeholder="99.90"
                                                            disabled={!product}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.semestral ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [product?.id]: { ...prev[product?.id], semestral: e.target.value },
                                                            }))}
                                                            placeholder="179.90"
                                                            disabled={!product}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <Input
                                                            value={edit.anual ?? ''}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [product?.id]: { ...prev[product?.id], anual: e.target.value },
                                                            }))}
                                                            placeholder="299.90"
                                                            disabled={!product}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!edit.is_active}
                                                            onChange={(e) => setStoreEdits((prev) => ({
                                                                ...prev,
                                                                [product?.id]: { ...prev[product?.id], is_active: e.target.checked },
                                                            }))}
                                                            disabled={!product}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => openEditPlatform(platform)}
                                                            >
                                                                Editar plataforma
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => product && saveStoreProduct(product)}
                                                                disabled={!product || saving}
                                                            >
                                                                {saving ? 'Salvando...' : 'Salvar'}
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="danger"
                                                                onClick={() => product && deleteStoreProduct(product)}
                                                                disabled={!product}
                                                            >
                                                                Excluir
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!activeStorePlatformRows.length && (
                                            <tr>
                                                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                                                    Nenhum item ativo encontrado para essa busca.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        <h4 className="text-sm font-semibold text-white mt-6 mb-3">Desativados da loja</h4>
                        <div className="relative overflow-x-auto rounded-xl border border-white/5">
                            {storeLoading ? (
                                <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                <table className="w-full text-left text-sm text-gray-300">
                                    <thead className="bg-white/5 text-xs uppercase text-gray-300">
                                        <tr>
                                            <th className="px-4 py-3">Produto</th>
                                            <th className="px-4 py-3">Tipo</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-right">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inactiveStorePlatformRows.map(({ platform, disabledProduct }) => (
                                            <tr key={`inactive-${platform.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors align-top">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        {platform.image_url ? (
                                                            <img src={platform.image_url} className="hidden sm:block w-8 h-8 rounded object-cover" />
                                                        ) : null}
                                                        <div className="min-w-0">
                                                            <div className="font-medium text-white truncate">{platform.name}</div>
                                                            <div className="text-xs text-gray-500 truncate">{disabledProduct?.slug || 'sem cadastro na loja'}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="rounded-full px-2 py-1 text-xs bg-white/10 text-gray-200">
                                                        {disabledProduct?.product_type || 'acesso'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="text-xs text-yellow-300">Desativado</span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button size="sm" variant="ghost" onClick={() => openEditPlatform(platform)}>
                                                            Editar plataforma
                                                        </Button>
                                                        <Button size="sm" onClick={() => addPlatformToStore(platform)}>
                                                            Adicionar
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {!inactiveStorePlatformRows.length && (
                                            <tr>
                                                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                                                    Nenhum item desativado encontrado para essa busca.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        <div className="mt-6 rounded-xl border border-white/10 p-4">
                            <h4 className="text-sm font-semibold text-white mb-3">Combos e extras</h4>
                            <div className="space-y-2 max-h-48 overflow-auto pr-1">
                                {filteredStoreProducts
                                    .filter((item) => item.product_type !== 'acesso')
                                    .map((item) => {
                                        const edit = storeEdits[item.id] || {};
                                        const comboActive = !!item.is_active && item.is_visible !== false && !isStoreRemoved(item);

                                        return (
                                        <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-sm text-white">{item.name}</p>
                                                <p className="text-[11px] text-gray-500">{item.slug} • ordem {item.sort_order ?? 0}</p>
                                                <p className={`text-[11px] ${comboActive ? 'text-green-300' : 'text-yellow-300'}`}>
                                                    {comboActive ? 'Ativo na loja' : 'Fora da loja'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={edit.sort_order ?? ''}
                                                    onChange={(e) => setStoreEdits((prev) => ({
                                                        ...prev,
                                                        [item.id]: { ...prev[item.id], sort_order: e.target.value },
                                                    }))}
                                                    className="w-24"
                                                    placeholder="Ordem"
                                                />
                                                <Button size="sm" onClick={() => saveStoreProduct(item)}>Salvar ordem</Button>
                                                {!comboActive ? (
                                                    <Button size="sm" onClick={() => reactivateStoreProduct(item)}>Adicionar novamente</Button>
                                                ) : null}
                                                <Button size="sm" onClick={() => setStoreSearch(item.slug || item.name)}>Editar</Button>
                                                <Button size="sm" variant="danger" onClick={() => deleteStoreProduct(item)}>Excluir</Button>
                                            </div>
                                        </div>
                                    );
                                    })}
                                {!filteredStoreProducts.filter((item) => item.product_type !== 'acesso').length && (
                                    <p className="text-xs text-gray-500">Nenhum combo/extra encontrado.</p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {(activeTab === 'courses' || activeTab === 'users') && (
            <Card>
                <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <CardTitle>{activeTab === 'courses' ? 'Plataformas Cadastradas' : 'Usuários Registrados'}</CardTitle>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                        <div className="relative w-full sm:w-auto">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                            <Input
                                placeholder={activeTab === 'courses' ? 'Buscar plataforma...' : 'Buscar usuário...'}
                                className="pl-9 w-full sm:w-[260px]"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        {activeTab === 'courses' && (
                            <Button onClick={openCreatePlatform} className="w-full sm:w-auto">
                                <Plus className="mr-2 h-4 w-4" /> Adicionar
                            </Button>
                        )}
                    </div>
                </CardHeader>

                <CardContent>
                    <div className="relative overflow-x-auto rounded-xl border border-white/5">
                        {(activeTab === 'courses' ? coursesLoading : usersLoading) ? (
                            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                        ) : (
                            <table className="w-full text-left text-sm text-gray-400">
                                <thead className="bg-white/5 text-xs uppercase text-gray-200">
                                    <tr>
                                        {activeTab === 'courses' ? (
                                            <th className="px-2 py-3 sm:px-3 sm:py-4 w-10" />
                                        ) : null}
                                        <th className="px-3 py-3 sm:px-6 sm:py-4">Nome</th>
                                        <th className="hidden sm:table-cell px-6 py-4">
                                            {activeTab === 'courses' ? 'Contas' : 'E-mail'}
                                        </th>
                                        {activeTab !== 'courses' ? (
                                            <th className="hidden sm:table-cell px-6 py-4">Telefone</th>
                                        ) : null}
                                        <th className="hidden sm:table-cell px-6 py-4">
                                            {activeTab === 'courses' ? 'Status' : 'Plano / Role'}
                                        </th>
                                        <th className="px-3 py-3 sm:px-6 sm:py-4 text-right">Ações</th>
                                    </tr>
                                </thead>

                                {activeTab === 'courses' ? (
                                    search.trim() ? (
                                        <tbody>
                                            {filteredCourses.map((course) => (
                                                <tr key={course.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                    <td className="px-2 py-3 sm:px-3 sm:py-4" />
                                                    <td className="px-3 py-3 sm:px-6 sm:py-4 font-medium text-white">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            {course.image_url && (
                                                                <img src={course.image_url} className="hidden sm:block w-8 h-8 rounded object-cover" />
                                                            )}
                                                            <span className="truncate">{course.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="hidden sm:table-cell px-6 py-4">—</td>
                                                    <td className="hidden sm:table-cell px-6 py-4">
                                                        <span className={cn(
                                                            "rounded-full px-2 py-1 text-xs font-medium",
                                                            course.status === 'active'
                                                                ? "bg-green-500/10 text-green-500"
                                                                : "bg-white/5 text-gray-400"
                                                        )}>
                                                            {course.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 sm:px-6 sm:py-4 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => openManageAccounts(course)}
                                                                className="p-2 text-gray-300 hover:bg-white/5 rounded-lg transition-colors"
                                                                title="Contas"
                                                            >
                                                                <KeyRound className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => openEditPlatform(course)}
                                                                className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                                title="Editar"
                                                            >
                                                                <Edit className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => deletePlatform(course.id)}
                                                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                                title="Excluir"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    ) : (
                                        <Reorder.Group
                                            as="tbody"
                                            axis="y"
                                            values={courses}
                                            onReorder={(next) => {
                                                setCourses(next);
                                                setOrderDirty(true);
                                            }}
                                        >
                                            {courses.map((course, idx) => (
                                                <ReorderablePlatformRow
                                                    key={course.id}
                                                    course={course}
                                                    dragEnabled={!coursesLoading && !reorderSaving}
                                                    onCommitOrder={() => {
                                                        if (!orderDirtyRef.current) return;
                                                        persistPlatformOrder(coursesRef.current);
                                                    }}
                                                    onMoveUp={() => movePlatform(course.id, 'up')}
                                                    onMoveDown={() => movePlatform(course.id, 'down')}
                                                    disableMoveUp={idx === 0}
                                                    disableMoveDown={idx === courses.length - 1}
                                                    onManageAccounts={() => openManageAccounts(course)}
                                                    onEdit={() => openEditPlatform(course)}
                                                    onDelete={() => deletePlatform(course.id)}
                                                />
                                            ))}
                                        </Reorder.Group>
                                    )
                                ) : (
                                    <tbody>
                                        {filteredUsers.map((user) => (
                                            <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="px-3 py-3 sm:px-6 sm:py-4 font-medium text-white">
                                                    <div className="flex flex-col">
                                                        <span className="truncate">{user.full_name || '—'}</span>
                                                        <span className="text-xs text-gray-500 truncate sm:hidden">{user.email}</span>
                                                    </div>
                                                </td>
                                                <td className="hidden sm:table-cell px-6 py-4">{user.email}</td>
                                                <td className="hidden sm:table-cell px-6 py-4">{user.whatsapp || '—'}</td>
                                                <td className="hidden sm:table-cell px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "rounded-full px-2 py-1 text-xs font-medium",
                                                            user.subscription_status && user.subscription_status !== 'teste-gratis'
                                                                ? "bg-green-500/10 text-green-500"
                                                                : "bg-white/5 text-gray-400"
                                                        )}>
                                                            {user.subscription_status || '—'}
                                                        </span>
                                                        <span className={cn(
                                                            "rounded-full px-2 py-1 text-xs font-medium",
                                                            user.role === 'admin'
                                                                ? "bg-primary/10 text-primary"
                                                                : "bg-white/5 text-gray-400"
                                                        )}>
                                                            {user.role}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 sm:px-6 sm:py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        
                                                        <button
                                                            title="Trocar role (admin/student)"
                                                            onClick={() => toggleUserRole(user)}
                                                            className={cn(
                                                                "p-2 rounded-lg transition-colors",
                                                                user.role === 'admin'
                                                                    ? "text-primary hover:bg-primary/10"
                                                                    : "text-gray-400 hover:bg-white/5"
                                                            )}
                                                        >
                                                            <Users className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            title="Editar usuário"
                                                            onClick={() => openEditUser(user)}
                                                            className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                )}
                            </table>
                        )}
                    </div>
                </CardContent>
            </Card>
            )}

            <Modal
                isOpen={isPlatformModalOpen}
                onClose={() => {
                    setIsPlatformModalOpen(false);
                    setPlatformEditingId(null);
                }}
                title={platformEditingId ? 'Editar Plataforma' : 'Adicionar Plataforma'}
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Nome da Plataforma</label>
                        <Input
                            value={platformForm.name}
                            onChange={(e) => setPlatformForm({ ...platformForm, name: e.target.value })}
                            placeholder="Ex: Curso X"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Descrição</label>
                        <Input
                            value={platformForm.description}
                            onChange={(e) => setPlatformForm({ ...platformForm, description: e.target.value })}
                            placeholder="Descrição breve"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">URL da Imagem</label>
                        <Input
                            value={platformForm.image_url}
                            onChange={(e) => setPlatformForm({ ...platformForm, image_url: e.target.value })}
                            placeholder="https://..."
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Status</label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={platformForm.status === 'active' ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, status: 'active' })}
                                className="flex-1"
                            >
                                Ativo
                            </Button>
                            <Button
                                type="button"
                                variant={platformForm.status === 'inactive' ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, status: 'inactive' })}
                                className="flex-1"
                            >
                                Inativo
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Visibilidade em Plataformas</label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={platformForm.is_visible ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, is_visible: true })}
                                className="flex-1"
                            >
                                Visível
                            </Button>
                            <Button
                                type="button"
                                variant={!platformForm.is_visible ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, is_visible: false })}
                                className="flex-1"
                            >
                                Oculto
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Link da Extensão</label>
                        <Input
                            value={platformForm.extension_link}
                            onChange={(e) => setPlatformForm({ ...platformForm, extension_link: e.target.value })}
                            placeholder="https://..."
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Quadrante de Contas</label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={platformForm.show_account_badge ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, show_account_badge: true })}
                                className="flex-1"
                            >
                                Ativado
                            </Button>
                            <Button
                                type="button"
                                variant={!platformForm.show_account_badge ? 'primary' : 'ghost'}
                                onClick={() => setPlatformForm({ ...platformForm, show_account_badge: false })}
                                className="flex-1"
                            >
                                Desativado
                            </Button>
                        </div>
                        <Input
                            type="number"
                            min="0"
                            value={platformForm.account_badge_count}
                            onChange={(e) => setPlatformForm({ ...platformForm, account_badge_count: e.target.value })}
                            placeholder="Quantidade exibida no quadrante"
                            disabled={!platformForm.show_account_badge}
                        />
                        <p className="text-xs text-gray-500">
                            Quando ativado, este número será mostrado no card da plataforma, mesmo sem contas cadastradas.
                        </p>
                    </div>
                    <div className="pt-4 flex justify-end gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                setIsPlatformModalOpen(false);
                                setPlatformEditingId(null);
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={savePlatform}>{platformEditingId ? 'Salvar Alterações' : 'Salvar Plataforma'}</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={isUserModalOpen}
                onClose={() => {
                    setIsUserModalOpen(false);
                    setSelectedUser(null);
                }}
                title="Editar Usuário"
            >
                <div className="space-y-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-400">E-mail</div>
                        <div className="text-white text-sm break-all">{selectedUser?.email}</div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Nome</label>
                        <Input
                            value={userForm.full_name}
                            onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                            placeholder="Nome completo"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">WhatsApp</label>
                        <Input
                            value={userForm.whatsapp}
                            onChange={(e) => setUserForm({ ...userForm, whatsapp: e.target.value })}
                            placeholder="(11) 99999-9999"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Plano</label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { key: 'teste-gratis', label: 'Teste Grátis' },
                                { key: 'mensal', label: 'Mensal' },
                                { key: 'trimestral', label: 'Trimestral' },
                                { key: 'semestral', label: 'Semestral' },
                                { key: 'anual', label: 'Anual' },
                            ].map((p) => (
                                <Button
                                    key={p.key}
                                    type="button"
                                    variant={userForm.subscription_status === p.key ? 'primary' : 'ghost'}
                                    onClick={() => setUserForm({ ...userForm, subscription_status: p.key })}
                                    className="w-full"
                                >
                                    {p.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Acessos ativos (com período)</label>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 max-h-[32vh] overflow-y-auto">
                            {userAccessLoading ? (
                                <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                (() => {
                                    const now = Date.now();
                                    const active = (userAssignments || []).filter((e) => {
                                        if (e.revoked_at) return false;
                                        const from = e.valid_from ? new Date(e.valid_from).getTime() : 0;
                                        const until = e.valid_until ? new Date(e.valid_until).getTime() : Infinity;
                                        return from <= now && until > now;
                                    });

                                    const activeSorted = [...active].sort((a, b) => {
                                        const aPriority = Date.parse(a?.valid_from || a?.created_at || '') || 0;
                                        const bPriority = Date.parse(b?.valid_from || b?.created_at || '') || 0;
                                        return bPriority - aPriority;
                                    });

                                    if (!active.length) {
                                        return <div className="text-sm text-gray-400">Nenhum acesso ativo.</div>;
                                    }

                                    const platformName = (e) => e?.platform_accounts?.platforms?.name
                                        || allPlatforms.find((p) => p.id === e?.platform_accounts?.platform_id)?.name
                                        || '—';
                                    const accountLabel = (e) => e?.platform_accounts?.label || '—';
                                    const fmt = (iso) => {
                                        if (!iso) return '—';
                                        const d = new Date(iso);
                                        return d.toLocaleDateString();
                                    };

                                    return (
                                        <div className="space-y-2">
                                            {activeSorted.map((e) => (
                                                <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-white truncate">{platformName(e)} • {accountLabel(e)}</div>
                                                        <div className="text-xs text-gray-400">{fmt(e.valid_from)} → {e.valid_until ? fmt(e.valid_until) : 'sem fim'} • {e.show_to_user ? 'visível' : 'oculto'}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button type="button" variant="ghost" className="h-9 px-3" onClick={() => startEditEntitlement(e)}>Editar</Button>
                                                        <Button type="button" variant="ghost" className="h-9 px-3 text-red-400" onClick={() => revokeEntitlement(e.id)}>Revogar</Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()
                            )}
                        </div>
                    </div>

                    {editingEntitlementId ? (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-400">Editar período do acesso</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <select
                                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                                    style={{ colorScheme: 'dark' }}
                                    value={entitlementEditForm.account_id}
                                    onChange={(e) => setEntitlementEditForm({ ...entitlementEditForm, account_id: e.target.value })}
                                >
                                    <option value="" className="bg-neutral-900 text-white">Conta…</option>
                                    {availableAccounts.map((a) => (
                                        <option key={a.id} value={a.id} className="bg-neutral-900 text-white">
                                            {a.label} ({a.status})
                                        </option>
                                    ))}
                                </select>
                                <Input
                                    type="date"
                                    value={entitlementEditForm.valid_from}
                                    onChange={(e) => setEntitlementEditForm({ ...entitlementEditForm, valid_from: e.target.value })}
                                />
                                <Input
                                    type="date"
                                    value={entitlementEditForm.valid_until}
                                    onChange={(e) => setEntitlementEditForm({ ...entitlementEditForm, valid_until: e.target.value })}
                                    placeholder="Fim (opcional)"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <Input
                                    value={entitlementEditForm.note}
                                    onChange={(e) => setEntitlementEditForm({ ...entitlementEditForm, note: e.target.value })}
                                    placeholder="Obs (opcional)"
                                />
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant={entitlementEditForm.show_to_user ? 'primary' : 'ghost'}
                                        onClick={() => setEntitlementEditForm({ ...entitlementEditForm, show_to_user: true })}
                                        className="flex-1"
                                    >
                                        Visível
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={!entitlementEditForm.show_to_user ? 'primary' : 'ghost'}
                                        onClick={() => setEntitlementEditForm({ ...entitlementEditForm, show_to_user: false })}
                                        className="flex-1"
                                    >
                                        Oculto
                                    </Button>
                                </div>
                            </div>
                            <Input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={entitlementEditForm.display_order}
                                onChange={(e) => setEntitlementEditForm({ ...entitlementEditForm, display_order: e.target.value })}
                                placeholder="Ordem"
                                className="sm:max-w-[220px]"
                            />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" onClick={() => setEditingEntitlementId(null)}>Cancelar</Button>
                                <Button type="button" onClick={saveEntitlementEdit}>Salvar período</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-400">Conceder novo acesso</label>
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                <select
                                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                                    style={{ colorScheme: 'dark' }}
                                    value={grantForm.platform_id}
                                    onChange={async (e) => {
                                        const platformId = e.target.value;
                                        setGrantForm({ ...grantForm, platform_id: platformId, account_id: '' });
                                        await loadAccountsForPlatform(platformId);
                                    }}
                                >
                                    <option value="" className="bg-neutral-900 text-white">Selecione…</option>
                                    {allPlatforms.map((p) => (
                                        <option key={p.id} value={p.id} className="bg-neutral-900 text-white">{p.name}</option>
                                    ))}
                                </select>
                                <select
                                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                                    style={{ colorScheme: 'dark' }}
                                    value={grantForm.account_id}
                                    onChange={(e) => setGrantForm({ ...grantForm, account_id: e.target.value })}
                                    disabled={!grantForm.platform_id}
                                >
                                    <option value="" className="bg-neutral-900 text-white">Conta…</option>
                                    {availableAccounts.map((a) => (
                                        <option key={a.id} value={a.id} className="bg-neutral-900 text-white">
                                            {a.label} ({a.status})
                                        </option>
                                    ))}
                                </select>
                                <Input
                                    type="date"
                                    value={grantForm.valid_from}
                                    onChange={(e) => setGrantForm({ ...grantForm, valid_from: e.target.value })}
                                />
                                <Input
                                    type="date"
                                    value={grantForm.valid_until}
                                    onChange={(e) => setGrantForm({ ...grantForm, valid_until: e.target.value })}
                                    placeholder="Fim (opcional)"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <Input
                                    value={grantForm.note}
                                    onChange={(e) => setGrantForm({ ...grantForm, note: e.target.value })}
                                    placeholder="Obs (opcional)"
                                />
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant={grantForm.show_to_user ? 'primary' : 'ghost'}
                                        onClick={() => setGrantForm({ ...grantForm, show_to_user: true })}
                                        className="flex-1"
                                    >
                                        Visível
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={!grantForm.show_to_user ? 'primary' : 'ghost'}
                                        onClick={() => setGrantForm({ ...grantForm, show_to_user: false })}
                                        className="flex-1"
                                    >
                                        Oculto
                                    </Button>
                                </div>
                            </div>
                            <Input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={grantForm.display_order}
                                onChange={(e) => setGrantForm({ ...grantForm, display_order: e.target.value })}
                                placeholder="Ordem"
                                className="sm:max-w-[220px]"
                            />
                            <div className="flex justify-end">
                                <Button type="button" onClick={grantAccess}>Conceder</Button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Role</label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={userForm.role === 'admin' ? 'primary' : 'ghost'}
                                onClick={() => setUserForm({ ...userForm, role: 'admin' })}
                                className="flex-1"
                            >
                                Admin
                            </Button>
                            <Button
                                type="button"
                                variant={userForm.role !== 'admin' ? 'primary' : 'ghost'}
                                onClick={() => setUserForm({ ...userForm, role: 'student' })}
                                className="flex-1"
                            >
                                Student
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Acesso à Loja (menu e rota)</label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={userForm.can_access_store ? 'primary' : 'ghost'}
                                onClick={() => setUserForm({ ...userForm, can_access_store: true })}
                                className="flex-1"
                            >
                                Liberado
                            </Button>
                            <Button
                                type="button"
                                variant={!userForm.can_access_store ? 'primary' : 'ghost'}
                                onClick={() => setUserForm({ ...userForm, can_access_store: false })}
                                className="flex-1"
                            >
                                Bloqueado
                            </Button>
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                setIsUserModalOpen(false);
                                setSelectedUser(null);
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={saveUser}>Salvar</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={isAccountsModalOpen}
                onClose={() => {
                    setIsAccountsModalOpen(false);
                    setAccountsPlatform(null);
                    setAccountEditingId(null);
                }}
                title={accountsPlatform ? `Contas: ${accountsPlatform.name}` : 'Contas'}
            >
                <div className="space-y-4">
                    <div className="text-sm text-gray-400">
                        Crie múltiplas contas (logins) por plataforma e acompanhe quantas pessoas estão usando cada uma.
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 max-h-[28vh] overflow-y-auto">
                        {platformAccountsLoading ? (
                            <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                        ) : (
                            <div className="space-y-2">
                                {platformAccounts.length === 0 ? (
                                    <div className="text-sm text-gray-400">Nenhuma conta cadastrada.</div>
                                ) : (
                                    platformAccounts.map((acc) => {
                                        const used = platformAccountSeatCounts[acc.id] || 0;
                                        const max = acc.max_seats == null ? '∞' : acc.max_seats;
                                        return (
                                            <div key={acc.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-white truncate">{acc.label || '—'}</div>
                                                    <div className="text-xs text-gray-400">{used}/{max} pessoas • {acc.status}</div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button type="button" variant="ghost" className="h-9 px-3" onClick={() => openEditAccount(acc)}>Editar</Button>
                                                    <Button type="button" variant="ghost" className="h-9 px-3 text-red-400" onClick={() => deleteAccount(acc.id)}>Excluir</Button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>

                    <div className="pt-2 border-t border-white/10" />

                    <div className="space-y-2">
                        <div className="text-sm font-medium text-gray-400">{accountEditingId ? 'Editar conta' : 'Nova conta'}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                                value={accountForm.label}
                                onChange={(e) => setAccountForm({ ...accountForm, label: e.target.value })}
                                placeholder="Rótulo (ex: Conta 1)"
                            />
                            <Input
                                type="number"
                                value={accountForm.max_seats}
                                onChange={(e) => setAccountForm({ ...accountForm, max_seats: e.target.value })}
                                placeholder="Vagas (vazio = ∞)"
                            />
                            <Input
                                value={accountForm.access_email}
                                onChange={(e) => setAccountForm({ ...accountForm, access_email: e.target.value })}
                                placeholder="E-mail de acesso"
                            />
                            <Input
                                value={accountForm.access_password}
                                onChange={(e) => setAccountForm({ ...accountForm, access_password: e.target.value })}
                                placeholder="Senha"
                            />
                            <Input
                                value={accountForm.extension_link}
                                onChange={(e) => setAccountForm({ ...accountForm, extension_link: e.target.value })}
                                placeholder="Link da extensão (opcional)"
                            />
                            <select
                                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
                                style={{ colorScheme: 'dark' }}
                                value={accountForm.status}
                                onChange={(e) => setAccountForm({ ...accountForm, status: e.target.value })}
                            >
                                <option value="active" className="bg-neutral-900 text-white">active</option>
                                <option value="inactive" className="bg-neutral-900 text-white">inactive</option>
                            </select>
                        </div>
                        <Input
                            value={accountForm.notes}
                            onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
                            placeholder="Observação (opcional)"
                        />

                        <div className="flex justify-end gap-2">
                            {accountEditingId && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setAccountEditingId(null);
                                        setAccountForm({
                                            label: '',
                                            access_email: '',
                                            access_password: '',
                                            extension_link: accountsPlatform?.extension_link ?? '',
                                            status: 'active',
                                            max_seats: '',
                                            notes: '',
                                        });
                                    }}
                                >
                                    Cancelar edição
                                </Button>
                            )}
                            <Button type="button" onClick={saveAccount}>{accountEditingId ? 'Salvar conta' : 'Adicionar conta'}</Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
