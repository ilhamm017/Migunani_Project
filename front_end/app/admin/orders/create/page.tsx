'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, Trash2, ShoppingCart, User as UserIcon, Check, MessageSquare, Paperclip, SendHorizontal, Minus, Plus, Layers, X } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import Image from 'next/image';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { notifyOpen, notifyAlert } from '@/lib/notify';
import ProductAliasModal from '@/components/admin/products/ProductAliasModal';
import CustomerTopProductsCard from '@/components/admin/orders/CustomerTopProductsCard';

type ChatContextMessage = {
    id?: string;
    body?: string;
    sender_type?: string;
    attachment_url?: string;
    createdAt?: string;
    created_at?: string;
};

type ChatSessionLookup = {
    id?: string;
    whatsapp_number?: string;
};

type ShippingMethodOption = {
    code: string;
    name: string;
    fee: number;
    is_active: boolean;
    sort_order?: number;
};

type CategoryTierDiscountRow = {
    id: number;
    name?: string;
    discount_regular_pct: number | null;
    discount_gold_pct: number | null;
    discount_premium_pct: number | null;
};

type CustomerOption = {
    id: string;
    name?: string;
    whatsapp_number?: string;
    status?: string;
    CustomerProfile?: {
        tier?: string;
    } | null;
};

type ProductOption = {
    id: string;
    sku?: string;
    name?: string;
    image_url?: string;
    stock_quantity?: number | string;
    price?: number | string;
    base_price?: number | string;
    category_id?: number | string;
    Category?: { id: number; name?: string } | null;
    varian_harga?: unknown;
};

type ClearancePromoOption = {
    id: string;
    name: string;
    product_id: string;
    pricing_mode: 'fixed_price' | 'percent_off' | string;
    promo_unit_price?: number | string | null;
    discount_pct?: number | string | null;
    target_unit_cost?: number | string | null;
    qty_limit?: number | string | null;
    qty_used?: number | string | null;
    remaining_qty?: number | string | null;
    computed_promo_unit_price?: number | string | null;
    normal_unit_price?: number | string | null;
    Product?: {
        id: string;
        sku?: string | null;
        name?: string | null;
        unit?: string | null;
        price?: number | string | null;
        image_url?: string | null;
        stock_quantity?: number | string | null;
    } | null;
};

type CartItem = {
    line_id: string;
    product_id: string;
    product: ProductOption;
    qty: number;
    clearance_promo_id?: string | null;
    clearance_promo?: ClearancePromoOption | null;
    unit_price_override?: number | null;
    discount_pct_input?: string;
    unit_price_override_input?: string;
    line_total_override_input?: string;
};

type PaymentMethodUi = 'transfer_manual' | 'cod' | 'cash_store' | 'follow_driver';

function ManualOrderContent() {
    const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
    const { user } = useAuthStore();
    const router = useRouter();
    const searchParams = useSearchParams();
    const customerIdParam = searchParams.get('customerId') || '';
    const chatSessionIdParam = searchParams.get('chatSessionId') || '';
    const isChatDrivenOrder = Boolean(chatSessionIdParam && customerIdParam);
    const canManageShippingConfig = ['super_admin', 'kasir'].includes(String(user?.role || ''));
    const canOverridePricing = ['super_admin', 'kasir'].includes(String(user?.role || '').trim());
    const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
    const canManageAliases = ['super_admin', 'kasir', 'admin_gudang'].includes(String(user?.role || '').trim());
    const [aliasModalOpen, setAliasModalOpen] = useState(false);
    const [aliasModalProduct, setAliasModalProduct] = useState<{ id: string; name?: string; sku?: string } | null>(null);

    const showSubmitPopup = useCallback((tone: 'success' | 'error' | 'info', title: string, message: string, ttlMs = 1800) => {
        notifyOpen({
            variant: tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'info',
            title,
            message,
            ...(tone === 'error' ? {} : { autoCloseMs: Math.max(800, Math.min(2500, Number(ttlMs) || 1800)) }),
        });
    }, []);

    // Customer Search State
    const [customerSearch, setCustomerSearch] = useState('');
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
    const [, setSearchingCustomers] = useState(false);

    // Product Search State
    const [productSearch, setProductSearch] = useState('');
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [, setSearchingProducts] = useState(false);

    // Clearance Promo (Active) Picker
    const [promoModalOpen, setPromoModalOpen] = useState(false);
    const [promoLoading, setPromoLoading] = useState(false);
    const [promoError, setPromoError] = useState('');
    const [promoSearch, setPromoSearch] = useState('');
    const [activePromos, setActivePromos] = useState<ClearancePromoOption[]>([]);
    const [promoQtyById, setPromoQtyById] = useState<Record<string, number>>({});

    // Cart State
    const [cart, setCart] = useState<CartItem[]>([]);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodUi>('follow_driver');
    const [submitting, setSubmitting] = useState(false);
    const [orderOverrideReason, setOrderOverrideReason] = useState('');
    const [prefillingCustomer, setPrefillingCustomer] = useState(false);
    const [chatContextLoading, setChatContextLoading] = useState(false);
    const [chatContextMessages, setChatContextMessages] = useState<ChatContextMessage[]>([]);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethodOption[]>([]);
    const [loadingShippingMethods, setLoadingShippingMethods] = useState(false);
    const [shippingMethodCode, setShippingMethodCode] = useState('');
    const [categoryDiscountById, setCategoryDiscountById] = useState<Map<number, CategoryTierDiscountRow>>(new Map());
    const [chatReplyText, setChatReplyText] = useState('');
    const [chatReplyAttachment, setChatReplyAttachment] = useState<File | null>(null);
    const [sendingChatReply, setSendingChatReply] = useState(false);
    const [chatReplyError, setChatReplyError] = useState('');

    const normalizeWhatsapp = useCallback((value?: string | null) => {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.startsWith('0')) return `62${digits.slice(1)}`;
        if (digits.startsWith('62')) return digits;
        if (digits.startsWith('8')) return `62${digits}`;
        return digits;
    }, []);

    const toObjectOrEmpty = useCallback((value: unknown): Record<string, unknown> => {
        if (!value) return {};
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return {};
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>;
                }
                return {};
            } catch {
                return {};
            }
        }
        if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
        return {};
    }, []);

    const tryResolveCustomerFromChatSession = useCallback(async () => {
        if (!chatSessionIdParam) return false;
        try {
            const sessionRes = await api.chat.getSessions();
            const sessions = Array.isArray(sessionRes.data?.sessions)
                ? sessionRes.data.sessions as ChatSessionLookup[]
                : [];
            const linkedSession = sessions.find((row) => String(row.id || '') === chatSessionIdParam);
            const whatsappFromSession = normalizeWhatsapp(linkedSession?.whatsapp_number);
            if (!whatsappFromSession) return false;

            const customerRes = await api.admin.customers.search(whatsappFromSession, { status: 'active', limit: 10 });
            const found = Array.isArray(customerRes.data?.customers)
                ? (customerRes.data.customers as CustomerOption[]).find((item) =>
                    normalizeWhatsapp(item.whatsapp_number) === whatsappFromSession
                )
                : null;

            if (!found) return false;
            setSelectedCustomer(found);
            setCustomerSearch('');
            setCustomers([]);
            return true;
        } catch {
            return false;
        }
    }, [chatSessionIdParam, normalizeWhatsapp]);

    // Debounced Search for Customers
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (customerSearch.length > 2) {
                setSearchingCustomers(true);
                try {
                    const res = await api.admin.customers.search(customerSearch, { status: 'active' });
                    setCustomers(Array.isArray(res.data?.customers) ? (res.data.customers as CustomerOption[]) : []);
                } catch (error) {
                    console.error(error);
                } finally {
                    setSearchingCustomers(false);
                }
            } else {
                setCustomers([]);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [customerSearch]);

    useEffect(() => {
        const loadPrefilledCustomer = async () => {
            if (!allowed || !customerIdParam) return;
            if (selectedCustomer?.id === customerIdParam) return;

            try {
                setPrefillingCustomer(true);
                const res = await api.admin.customers.getById(customerIdParam);
                const customer = res.data?.customer as CustomerOption | undefined;
                if (customer && customer.status === 'active') {
                    setSelectedCustomer(customer);
                    setCustomerSearch('');
                    setCustomers([]);
                    return;
                }
                notifyAlert('Customer tidak aktif. Order tidak bisa dibuat.');
            } catch (error: unknown) {
                const statusCode = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
                if (statusCode === 404) {
                    if (isChatDrivenOrder) {
                        const resolved = await tryResolveCustomerFromChatSession();
                        if (resolved) return;
                        notifyAlert('Customer pada sesi chat belum terdaftar. Tombol Buat Order hanya untuk customer terdaftar.');
                    } else {
                        notifyAlert('Customer tidak ditemukan.');
                    }
                    return;
                }
                console.error('Failed to prefill customer:', error);
            } finally {
                setPrefillingCustomer(false);
            }
        };

        void loadPrefilledCustomer();
    }, [allowed, customerIdParam, selectedCustomer?.id, isChatDrivenOrder, tryResolveCustomerFromChatSession]);

    const refreshChatContext = useCallback(async (sessionId: string) => {
        try {
            setChatContextLoading(true);
            const res = await api.chat.getMessages(sessionId);
            const rows = Array.isArray(res.data?.messages) ? res.data.messages : [];
            setChatContextMessages(rows as ChatContextMessage[]);
        } catch (error) {
            console.error('Failed to load chat context:', error);
            setChatContextMessages([]);
        } finally {
            setChatContextLoading(false);
        }
    }, []);

	    useEffect(() => {
	        const loadShippingMethods = async () => {
	            if (!allowed) return;
	            try {
	                setLoadingShippingMethods(true);
                const res = await api.admin.shippingMethods.getAll({ active_only: true });
                const rows = Array.isArray(res.data?.shipping_methods)
                    ? (res.data.shipping_methods as ShippingMethodOption[])
                    : [];
                setShippingMethods(rows);
                setShippingMethodCode((prev) => {
                    if (prev && rows.some((item) => item.code === prev)) return prev;
                    return rows[0]?.code || '';
                });
            } catch (error) {
                console.error('Failed to load shipping methods:', error);
                setShippingMethods([]);
                setShippingMethodCode('');
            } finally {
                setLoadingShippingMethods(false);
            }
        };

	        void loadShippingMethods();
	    }, [allowed]);

        useEffect(() => {
            const loadCategoryDiscounts = async () => {
                if (!allowed) return;
                try {
                    const res = await api.admin.inventory.getCategories();
                    const rows = Array.isArray(res.data?.categories) ? (res.data.categories as unknown[]) : [];
                    const next = new Map<number, CategoryTierDiscountRow>();

                    const toNullablePct = (value: unknown): number | null => {
                        const parsed = Number(value);
                        if (!Number.isFinite(parsed)) return null;
                        if (parsed < 0 || parsed > 100) return null;
                        return parsed;
                    };

                    for (const row of rows) {
                        const record = (row && typeof row === 'object' && !Array.isArray(row)) ? (row as Record<string, unknown>) : null;
                        if (!record) continue;
                        const id = Number(record.id);
                        if (!Number.isInteger(id) || id <= 0) continue;
                        next.set(id, {
                            id,
                            name: typeof record.name === 'string' ? record.name : undefined,
                            discount_regular_pct: toNullablePct(record.discount_regular_pct),
                            discount_gold_pct: toNullablePct(record.discount_gold_pct),
                            discount_premium_pct: toNullablePct(record.discount_premium_pct),
                        });
                    }

                    setCategoryDiscountById(next);
                } catch {
                    setCategoryDiscountById(new Map());
                }
            };

            void loadCategoryDiscounts();
        }, [allowed]);

    useEffect(() => {
        if (!allowed || !chatSessionIdParam) {
            setChatContextMessages([]);
            return;
        }
        void refreshChatContext(chatSessionIdParam);
    }, [allowed, chatSessionIdParam, refreshChatContext]);

	    // Debounced Search for Products
	    useEffect(() => {
	        const delayDebounceFn = setTimeout(async () => {
	            if (productSearch.length > 2) {
                setSearchingProducts(true);
                try {
                    const res = await api.admin.inventory.getProducts({ search: productSearch, limit: 10, status: 'active', sort_by: 'stock_desc' });
                    const rows = Array.isArray(res.data?.products) ? (res.data.products as ProductOption[]) : [];
                    const sorted = rows.slice().sort((a, b) => {
                        const qtyA = Number(a?.stock_quantity || 0);
                        const qtyB = Number(b?.stock_quantity || 0);
                        const safeA = Number.isFinite(qtyA) ? qtyA : 0;
                        const safeB = Number.isFinite(qtyB) ? qtyB : 0;
                        if (safeA !== safeB) return safeB - safeA;
                        return String(a?.name || '').localeCompare(String(b?.name || ''));
                    });
                    setProducts(sorted);
                } catch (error) {
                    console.error(error);
                } finally {
                    setSearchingProducts(false);
                }
            } else {
                setProducts([]);
            }
        }, 500);

	        return () => clearTimeout(delayDebounceFn);
	    }, [productSearch]);

	        const loadActivePromos = useCallback(async () => {
	            try {
	                setPromoLoading(true);
	                setPromoError('');
	                const res = await api.clearancePromos.getActive();
	                const promos: ClearancePromoOption[] = Array.isArray(res.data?.promos) ? res.data.promos : [];
	                setActivePromos(promos);
	            } catch (e: unknown) {
                    const err = e as { response?: { data?: { message?: unknown } } };
                    const message = typeof err?.response?.data?.message === 'string'
                        ? err.response.data.message
                        : '';
	                setActivePromos([]);
	                setPromoError(message || 'Gagal memuat promo cepat habis.');
	            } finally {
	                setPromoLoading(false);
	            }
	        }, []);

        useEffect(() => {
            if (!allowed || !promoModalOpen) return;
            void loadActivePromos();
        }, [allowed, promoModalOpen, loadActivePromos]);

	    const toFiniteNumber = (value: unknown): number | null => {
	        const parsed = Number(value);
	        if (!Number.isFinite(parsed)) return null;
	        return parsed;
	    };

        const clampPercentage = (value: number): number => {
            return Math.min(100, Math.max(0, value));
        };

        const formatIdrNumber = (value: unknown): string => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return '';
            const normalized = Math.max(0, Math.trunc(parsed));
            return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(normalized);
        };

        const parseIdrInput = (raw: string): number | null => {
            const digits = String(raw || '').replace(/[^\d]/g, '');
            if (!digits) return null;
            const parsed = Number(digits);
            if (!Number.isFinite(parsed)) return null;
            return Math.max(0, Math.trunc(parsed));
        };

        const getProductRegularUnitPrice = (product: ProductOption): number => {
            const variant = toObjectOrEmpty(product.varian_harga);
            const prices = toObjectOrEmpty(variant.prices);
            const candidates: unknown[] = [
                product.price,
                prices.regular,
                variant.regular,
                prices.base_price,
                variant.base_price,
            ];

            for (const candidate of candidates) {
                const parsed = Number(candidate);
                if (Number.isFinite(parsed) && parsed > 0) return Math.max(0, parsed);
            }

            const fallback = Number(product.price || 0);
            return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
        };

	    const getProductPrice = (product: ProductOption) => {
	        const tierRaw = selectedCustomer?.CustomerProfile?.tier || 'regular';
	        const tier = String(tierRaw || 'regular').trim().toLowerCase() === 'premium'
	            ? 'platinum'
	            : String(tierRaw || 'regular').trim().toLowerCase();

            const effectiveBasePrice = getProductRegularUnitPrice(product);
            const variant = toObjectOrEmpty(product.varian_harga);
            const prices = toObjectOrEmpty(variant.prices);

            const resolveCategoryDiscountPct = (): number | null => {
                const categoryIdRaw = (product.Category && typeof product.Category === 'object')
                    ? (product.Category as { id?: unknown }).id
                    : product.category_id;
                const categoryId = Number(categoryIdRaw);
                if (!Number.isInteger(categoryId) || categoryId <= 0) return null;
                const category = categoryDiscountById.get(categoryId);
                if (!category) return null;
                if (tier === 'platinum') return category.discount_premium_pct;
                if (tier === 'gold') return category.discount_gold_pct;
                if (tier === 'regular') return category.discount_regular_pct;
                return null;
            };

            if (tier === 'regular') {
                const categoryPct = resolveCategoryDiscountPct();
                if (categoryPct !== null && categoryPct > 0) {
                    return Math.max(0, Math.round((effectiveBasePrice * (1 - categoryPct / 100)) * 100) / 100);
                }
                return effectiveBasePrice;
            }

            const aliases = tier === 'platinum' ? ['premium'] : [];
            const directCandidates: unknown[] = [
                variant[tier],
                prices[tier],
                toObjectOrEmpty(variant[tier]).price
            ];
            for (const alias of aliases) {
                directCandidates.push(variant[alias], prices[alias], toObjectOrEmpty(variant[alias]).price);
            }
            for (const candidate of directCandidates) {
                const directPrice = toFiniteNumber(candidate);
                if (directPrice !== null && directPrice > 0) return Math.max(0, directPrice);
            }

            const discounts = toObjectOrEmpty(variant.discounts_pct);
            const discountCandidates: unknown[] = [
                discounts[tier],
                toObjectOrEmpty(variant[tier]).discount_pct,
                variant[`${tier}_discount_pct`]
            ];
            for (const alias of aliases) {
                discountCandidates.push(discounts[alias], toObjectOrEmpty(variant[alias]).discount_pct, variant[`${alias}_discount_pct`]);
            }
            for (const discountRaw of discountCandidates) {
                const discountPct = toFiniteNumber(discountRaw);
                if (discountPct === null || discountPct <= 0 || discountPct > 100) continue;
                return Math.max(0, Math.round((effectiveBasePrice * (1 - discountPct / 100)) * 100) / 100);
            }

            const categoryPct = resolveCategoryDiscountPct();
            if (categoryPct !== null && categoryPct > 0) {
                return Math.max(0, Math.round((effectiveBasePrice * (1 - categoryPct / 100)) * 100) / 100);
            }

            return effectiveBasePrice;
	    };

			    const getDealUnitPrice = (item: CartItem) => {
                    if (item.clearance_promo_id) {
                        const promo = item.clearance_promo;
                        const pricingMode = String(promo?.pricing_mode || '');
                        if (pricingMode === 'fixed_price') {
                            const v = Number(promo?.promo_unit_price || 0);
                            return Number.isFinite(v) ? Math.max(0, v) : 0;
                        }
                        const v = Number(promo?.computed_promo_unit_price || 0);
                        return Number.isFinite(v) ? Math.max(0, v) : 0;
                    }
			        const overrideRaw = item?.unit_price_override;
			        const override = overrideRaw === undefined || overrideRaw === null ? NaN : Number(overrideRaw);
			        if (Number.isFinite(override) && override > 0) return Math.max(0, override);
			        return Math.max(0, getProductPrice(item.product));
			    };

            const validateBeforeSubmit = useCallback(() => {
                if (!selectedCustomer) {
                    showSubmitPopup('error', 'Gagal', 'Pilih customer terlebih dahulu');
                    return false;
                }
                if (selectedCustomer.status !== 'active') {
                    showSubmitPopup('error', 'Gagal', 'Customer sedang diblokir');
                    return false;
                }
                if (cart.length === 0) {
                    showSubmitPopup('error', 'Gagal', 'Keranjang kosong');
                    return false;
                }
                if (shippingMethods.length > 0 && !shippingMethodCode) {
                    showSubmitPopup('error', 'Gagal', 'Pilih jenis pengiriman terlebih dahulu');
                    return false;
                }

	                if (canOverridePricing && String(user?.role || '').trim() === 'kasir') {
	                    const invalid = cart.find((item) => {
                            if (item.clearance_promo_id) return false;
	                        const deal = getDealUnitPrice(item);
	                        const costRaw = Number(item?.product?.base_price);
	                        if (!Number.isFinite(costRaw) || costRaw <= 0) return false;
	                        return deal < costRaw;
	                    });
                    if (invalid) {
                        showSubmitPopup('error', 'Tidak Diizinkan', 'Kasir tidak boleh menurunkan harga di bawah modal. (Cek harga deal vs base_price produk)');
                        return false;
                    }
                }

                return true;
            }, [canOverridePricing, cart, getDealUnitPrice, selectedCustomer, shippingMethodCode, shippingMethods.length, showSubmitPopup, user?.role]);
		
			    const addToCart = (product: ProductOption) => {
				        setCart(prev => {
				            const lineId = `product:${product.id}`;
				            const existing = prev.find(item => item.line_id === lineId);
			            if (existing) {
			                return prev.map(item => item.line_id === lineId ? { ...item, qty: item.qty + 1 } : item);
			            }
			            // New picked product should appear on top (most recently added first).
			            return [{
                            line_id: lineId,
                            product_id: product.id,
                            product,
                            qty: 1,
                            unit_price_override: null,
                            discount_pct_input: undefined,
                            unit_price_override_input: undefined,
                            line_total_override_input: undefined,
                            clearance_promo_id: null,
                            clearance_promo: null
                        }, ...prev];
			        });
			        setProductSearch('');
			        setProducts([]);
			    };

            const addPromoToCart = (promo: ClearancePromoOption, qtyToAdd = 1) => {
                const promoId = String(promo?.id || '').trim();
                const productId = String(promo?.product_id || promo?.Product?.id || '').trim();
                if (!promoId || !productId) return;
                const remaining = Math.max(0, Math.trunc(Number(promo?.remaining_qty || 0)));
                const safeQty = Math.max(1, Math.min(remaining || 0, Math.trunc(Number(qtyToAdd || 1))));
                if (remaining <= 0 || safeQty <= 0) return;

                const lineId = `promo:${promoId}`;
                const product: ProductOption = {
                    id: productId,
                    sku: String(promo?.Product?.sku || ''),
                    name: String(promo?.Product?.name || promo?.name || ''),
                    image_url: promo?.Product?.image_url ? String(promo.Product.image_url) : undefined,
                    stock_quantity: promo?.Product?.stock_quantity ?? undefined,
                    price: promo?.Product?.price ?? undefined,
                };

                setCart((prev) => {
                    const existing = prev.find((row) => row.line_id === lineId);
                    if (existing) {
                        return prev.map((row) => row.line_id === lineId ? { ...row, qty: row.qty + safeQty } : row);
                    }
	                    return [{
	                        line_id: lineId,
	                        product_id: productId,
	                        product,
	                        qty: safeQty,
	                        clearance_promo_id: promoId,
	                        clearance_promo: promo,
	                        unit_price_override: null,
                            discount_pct_input: undefined,
                            unit_price_override_input: undefined,
                            line_total_override_input: undefined,
	                    }, ...prev];
	                });
	            };

	    const removeFromCart = (lineId: string) => {
	        setCart(prev => prev.filter(item => item.line_id !== lineId));
	    };

		    const updateQty = (lineId: string, delta: number) => {
		        setCart(prev => prev.map(item => {
		            if (item.line_id === lineId) {
		                const newQty = Math.max(1, item.qty + delta);
		                return { ...item, qty: newQty, line_total_override_input: undefined };
		            }
		            return item;
		        }));
		    };

		    const setQty = (lineId: string, rawValue: string) => {
		        const parsed = Number(rawValue);
		        const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
		        const nextQty = Math.max(1, normalized);
		        setCart((prev) => prev.map((item) => (item.line_id === lineId ? { ...item, qty: nextQty, line_total_override_input: undefined } : item)));
		    };

		    const calculateSubtotal = () => {
		        return cart.reduce((sum, item) => sum + (getDealUnitPrice(item) * item.qty), 0);
		    };

            const filteredPromos = useMemo(() => {
                const q = promoSearch.trim().toLowerCase();
                const base = Array.isArray(activePromos) ? activePromos : [];
                const rows = q
                    ? base.filter((promo) => {
                        const name = String(promo?.Product?.name || promo?.name || '').toLowerCase();
                        const sku = String(promo?.Product?.sku || '').toLowerCase();
                        const promoName = String(promo?.name || '').toLowerCase();
                        return name.includes(q) || sku.includes(q) || promoName.includes(q);
                    })
                    : base;

	                return rows.slice().sort((a, b) => {
	                    const aRemaining = Math.max(0, Math.trunc(Number(a?.remaining_qty || 0)));
	                    const bRemaining = Math.max(0, Math.trunc(Number(b?.remaining_qty || 0)));
	                    if (aRemaining !== bRemaining) return bRemaining - aRemaining;
	                    return String(a?.Product?.name || a?.name || '').localeCompare(String(b?.Product?.name || b?.name || ''));
	                });
	            }, [activePromos, promoSearch]);

	    const selectedShippingMethod = shippingMethods.find((item) => item.code === shippingMethodCode) || null;
    const shippingFee = Number(selectedShippingMethod?.fee || 0);
    const grandTotal = calculateSubtotal() + shippingFee;

    const formatChatContextTime = (message: ChatContextMessage) => {
        const raw = message.created_at || message.createdAt;
        if (!raw) return '';
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('id-ID', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    const isImageAttachment = (attachmentUrl?: string) => {
        if (!attachmentUrl) return false;
        return /\.(png|jpe?g|webp|gif)$/i.test(attachmentUrl);
    };

    const handleSendChatReply = async () => {
        if (!chatSessionIdParam) return;
        if (!chatReplyText.trim() && !chatReplyAttachment) return;

        try {
            setSendingChatReply(true);
            setChatReplyError('');
            await api.chat.replyToChat(chatSessionIdParam, {
                message: chatReplyText,
                attachment: chatReplyAttachment
            });
            setChatReplyText('');
            setChatReplyAttachment(null);
            await refreshChatContext(chatSessionIdParam);
        } catch (error: unknown) {
            console.error('Failed to send chat context reply:', error);
            setChatReplyError((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Gagal mengirim balasan chat.');
        } finally {
            setSendingChatReply(false);
        }
    };

			    const handleSubmit = () => {
                    if (submitting) return;
                    if (!validateBeforeSubmit()) return;
                    setSubmitConfirmOpen(true);
                };

                const submitOrder = async () => {
                    if (submitting) return;
                    if (!validateBeforeSubmit()) return;
                    setSubmitConfirmOpen(false);
                    showSubmitPopup('info', 'Memproses', 'Membuat pesanan...');

			        setSubmitting(true);
			        try {
		            const orderReason = orderOverrideReason.trim();
			            const payload: Parameters<typeof api.orders.checkout>[0] = {
			                ...(selectedCustomer?.id ? { customer_id: selectedCustomer.id } : {}), // Only works if admin
			                items: cart.map(item => {
			                    const baseline = Math.max(0, getProductPrice(item.product));
			                    const deal = Math.max(0, getDealUnitPrice(item));
	                            const promoId = String(item.clearance_promo_id || '').trim();
			                    return {
			                        product_id: item.product.id,
			                        qty: item.qty,
	                                ...(promoId ? { clearance_promo_id: promoId } : {}),
			                        ...(!promoId && canOverridePricing && deal > 0 && Math.abs(deal - baseline) > 0.0001 ? { unit_price_override: deal } : {})
			                    };
			                }),
		                shipping_method_code: shippingMethodCode || undefined,
		                from_cart: false,
		                ...(paymentMethod !== 'follow_driver' ? { payment_method: paymentMethod } : {}),
	                ...(canOverridePricing && orderReason ? { price_override_reason: orderReason } : {})
	            };

	            const res = await api.orders.checkout(payload);
	            const created = (res?.data || {}) as {
	                order_id?: string;
	                total_amount?: number | string;
	                shipping_method_name?: string | null;
	            };
	            const orderId = String(created.order_id || '').trim();
	            const totalCreated = Number(created.total_amount || 0);
	            const shippingName = String(created.shipping_method_name || '').trim();
	            const itemCount = cart.reduce((sum, row) => sum + Number(row.qty || 0), 0);

	            const headlineParts = [
	                orderId ? `Order #${orderId}` : null,
	                selectedCustomer?.name ? String(selectedCustomer.name) : null,
	            ].filter(Boolean);
	            const detailParts = [
	                itemCount > 0 ? `${itemCount} item` : null,
	                Number.isFinite(totalCreated) && totalCreated > 0 ? `Total ${formatCurrency(totalCreated)}` : null,
	                shippingName ? `Kirim: ${shippingName}` : null,
	            ].filter(Boolean);

	            showSubmitPopup(
	                'success',
	                headlineParts.length > 0 ? headlineParts.join(' • ') : 'Berhasil',
	                detailParts.length > 0 ? detailParts.join(' • ') : 'Pesanan berhasil dibuat!',
	                2200
	            );
		            window.setTimeout(() => {
		                router.push('/admin/orders');
		            }, 1700);
		        } catch (error: unknown) {
		            console.error(error);
	            showSubmitPopup(
	                'error',
	                'Gagal',
	                (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Gagal membuat pesanan'
	            );
		        } finally {
		            setSubmitting(false);
		        }
		        };

	    if (!allowed) return null;
	
		    return (
		        <div className="p-6 space-y-6">
                    {promoModalOpen && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
                            <div className="w-full max-w-4xl bg-white rounded-3xl border border-slate-200 shadow-xl p-4 space-y-3 mt-10">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Popup Promo</p>
                                        <h2 className="text-base font-black text-slate-900 mt-0.5 flex items-center gap-2">
                                            <Layers size={16} /> Pilih Promo Cepat Habis
                                        </h2>
                                        <p className="text-xs text-slate-500 mt-1">Pilih promo yang akan dibeli. Sistem akan split otomatis jika qty melebihi sisa promo.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPromoModalOpen(false)}
                                        className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700"
                                    >
                                        <X size={14} /> Tutup
                                    </button>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        value={promoSearch}
                                        onChange={(e) => setPromoSearch(e.target.value)}
                                        placeholder="Cari promo (nama produk / SKU / nama promo)"
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void loadActivePromos()}
                                        disabled={promoLoading}
                                        className="inline-flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-60"
                                    >
                                        <Search size={14} /> {promoLoading ? 'Memuat...' : 'Refresh'}
                                    </button>
                                </div>

                                {promoError ? (
                                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{promoError}</div>
                                ) : promoLoading ? (
                                    <div className="text-sm text-slate-500">Memuat promo...</div>
                                ) : filteredPromos.length === 0 ? (
                                    <div className="text-sm text-slate-500">Tidak ada promo aktif.</div>
                                ) : (
                                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                                        {filteredPromos.map((promo) => {
                                            const promoId = String(promo.id || '').trim();
                                            const productName = String(promo?.Product?.name || promo.name || 'Produk');
                                            const sku = String(promo?.Product?.sku || '').trim();
                                            const unit = String(promo?.Product?.unit || 'Pcs');
                                            const remaining = Math.max(0, Math.trunc(Number(promo.remaining_qty || 0)));
                                            const qtyLimit = promo.qty_limit === null || promo.qty_limit === undefined ? null : Math.max(0, Math.trunc(Number(promo.qty_limit || 0)));
                                            const qtyUsed = promo.qty_used === null || promo.qty_used === undefined ? 0 : Math.max(0, Math.trunc(Number(promo.qty_used || 0)));
                                            const remainingAllocation = qtyLimit === null ? null : Math.max(0, qtyLimit - qtyUsed);
                                            const qty = Math.max(1, Math.min(remaining || 1, Math.trunc(Number(promoQtyById[promoId] || 1))));
                                            const promoPrice = Number(promo.computed_promo_unit_price || promo.promo_unit_price || 0);
                                            const normalPrice = Number(promo.normal_unit_price || promo?.Product?.price || 0);
                                            const disabled = remaining <= 0;

                                            return (
                                                <div key={promoId} className={`rounded-2xl border p-3 ${disabled ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-black text-slate-900 truncate">
                                                                {productName} {sku ? <span className="text-slate-500 font-bold">({sku})</span> : null}
                                                            </p>
                                                            <p className="text-[11px] text-slate-500 mt-1">
                                                                {qtyLimit === null
                                                                    ? `Sisa promo: ${remaining.toLocaleString('id-ID')} ${unit}`
                                                                    : `Alokasi: ${qtyLimit.toLocaleString('id-ID')} • Terpakai: ${qtyUsed.toLocaleString('id-ID')} • Sisa alokasi: ${(remainingAllocation || 0).toLocaleString('id-ID')} • Sisa promo: ${remaining.toLocaleString('id-ID')} ${unit}`
                                                                }
                                                            </p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            {normalPrice > 0 ? (
                                                                <p className="text-[11px] text-slate-500 line-through">{formatCurrency(normalPrice)}</p>
                                                            ) : null}
                                                            <p className="text-xs font-black text-emerald-700">{formatCurrency(Number.isFinite(promoPrice) ? promoPrice : 0)}</p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] text-slate-500">Qty</span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={remaining}
                                                                disabled={disabled}
                                                                value={qty}
                                                                onChange={(e) => {
                                                                    const next = Math.min(remaining || 1, Math.max(1, Math.trunc(Number(e.target.value || 1))));
                                                                    setPromoQtyById((prev) => ({ ...prev, [promoId]: next }));
                                                                }}
                                                                className="w-24 h-9 px-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={disabled}
                                                            onClick={() => {
                                                                addPromoToCart(promo, qty);
                                                                setPromoQtyById((prev) => ({ ...prev, [promoId]: 1 }));
                                                            }}
                                                            className="btn-3d inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide px-4 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
                                                        >
                                                            <Plus size={14} /> Tambah
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
	            <div className="flex items-center gap-4">
	                <Link href="/admin/orders" className="p-2 hover:bg-slate-100 rounded-full text-slate-600">
	                    <ArrowLeft size={20} />
	                </Link>
                <div>
                    <h1 className="text-2xl font-black text-slate-900">Buat Pesanan Manual</h1>
                    <p className="text-slate-500 text-sm">Input pesanan untuk pelanggan offline atau via WhatsApp</p>
                </div>
            </div>

            {chatSessionIdParam && (
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-bold text-slate-900 flex items-center gap-2">
                            <MessageSquare size={18} />
                            Konteks Chat Customer
                        </h2>
                        <Link
                            href={`/admin/chat?sessionId=${encodeURIComponent(chatSessionIdParam)}`}
                            className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
                        >
                            Kembali ke sesi chat
                        </Link>
                    </div>

                    {chatContextLoading ? (
                        <p className="text-sm text-slate-500">Memuat konteks chat...</p>
                    ) : chatContextMessages.length === 0 ? (
                        <p className="text-sm text-slate-500">Belum ada pesan pada sesi chat ini.</p>
                    ) : (
                        <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                            {chatContextMessages.slice(-20).map((message, index) => {
                                const isAdminMessage = message.sender_type === 'admin';
                                return (
                                    <div
                                        key={`${message.id || 'ctx'}-${index}`}
                                        className={`flex ${isAdminMessage ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[82%] rounded-2xl px-3 py-2 border ${isAdminMessage
                                                ? 'border-emerald-200 bg-emerald-50'
                                                : 'border-slate-200 bg-white'
                                                }`}
                                        >
                                            <p className={`text-[11px] font-bold ${isAdminMessage ? 'text-emerald-700' : 'text-slate-700'}`}>
                                                {isAdminMessage ? 'Admin' : 'Customer'}
                                            </p>
                                            {message.body ? (
                                                <p className="text-xs text-slate-700 whitespace-pre-wrap mt-1">{message.body}</p>
                                            ) : null}
                                            {message.attachment_url ? (
                                                <div className="mt-2">
                                                    {isImageAttachment(message.attachment_url) ? (
                                                        <a href={message.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                                                            <Image src={message.attachment_url} alt="Lampiran chat" width={96} height={96} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
                                                        </a>
                                                    ) : (
                                                        <a
                                                            href={message.attachment_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                                                        >
                                                            <Paperclip size={12} />
                                                            Lihat lampiran
                                                        </a>
                                                    )}
                                                </div>
                                            ) : null}
                                            <p className="text-[10px] text-slate-500 mt-1 text-right">{formatChatContextTime(message)}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="border-t border-slate-100 pt-3 space-y-2">
                        <textarea
                            rows={2}
                            value={chatReplyText}
                            onChange={(e) => setChatReplyText(e.target.value)}
                            placeholder="Ketik balasan chat dari halaman ini..."
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {chatReplyAttachment && (
                            <p className="text-xs text-emerald-700 font-semibold">
                                Lampiran: {chatReplyAttachment.name}
                            </p>
                        )}
                        {chatReplyError ? (
                            <p className="text-xs text-rose-600">{chatReplyError}</p>
                        ) : null}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer">
                                <Paperclip size={14} />
                                Lampirkan File
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => setChatReplyAttachment(e.target.files?.[0] || null)}
                                />
                            </label>
                            <button
                                type="button"
                                onClick={handleSendChatReply}
                                disabled={sendingChatReply || (!chatReplyText.trim() && !chatReplyAttachment)}
                                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <SendHorizontal size={14} />
                                {sendingChatReply ? 'Mengirim...' : 'Kirim Balasan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

			            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
			                {/* Left Column: Selection (digabung jadi 1 card) */}
			                <div className="order-1 lg:order-1 lg:col-span-1">
			                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
			                        <div className="space-y-6">
		                            {/* Customer Selection */}
		                            {!isChatDrivenOrder ? (
		                                <div className="space-y-4">
		                                    <h2 className="font-bold text-slate-900 flex items-center gap-2">
		                                        <UserIcon size={18} /> Pilih Pelanggan
		                                    </h2>

		                                    {!selectedCustomer ? (
		                                        <div className="relative">
		                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
		                                            <input
		                                                type="text"
		                                                placeholder="Cari nama, WA, atau email..."
		                                                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
		                                                value={customerSearch}
		                                                onChange={(e) => setCustomerSearch(e.target.value)}
		                                                disabled={prefillingCustomer}
		                                            />
		                                            {prefillingCustomer && (
		                                                <p className="text-xs text-slate-500 mt-2 ml-2">Memuat customer dari halaman sebelumnya...</p>
		                                            )}
		                                            {customers.length > 0 && (
		                                                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto">
		                                                    {customers.map(c => (
		                                                        <div
		                                                            key={c.id}
		                                                            className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0"
		                                                            onClick={() => {
		                                                                setSelectedCustomer(c);
		                                                                setCustomerSearch('');
		                                                                setCustomers([]);
		                                                            }}
		                                                        >
		                                                            <p className="font-bold text-slate-900">{c.name}</p>
		                                                            <div className="flex gap-3 text-xs text-slate-500">
		                                                                <span>{c.whatsapp_number}</span>
		                                                                <span className="capitalize px-2 py-0.5 bg-slate-100 rounded-full text-slate-600">
		                                                                    Tier: {c.CustomerProfile?.tier || 'Regular'}
		                                                                </span>
		                                                            </div>
		                                                        </div>
		                                                    ))}
		                                                </div>
		                                            )}
		                                        </div>
		                                    ) : (
		                                        <div className="flex items-center justify-between bg-blue-50 p-4 rounded-xl border border-blue-100">
		                                            <div>
		                                                <p className="font-bold text-blue-900">{selectedCustomer.name}</p>
		                                                <p className="text-sm text-blue-700">{selectedCustomer.whatsapp_number}</p>
		                                                <span className="text-xs bg-white text-blue-600 px-2 py-0.5 rounded-full border border-blue-200 mt-1 inline-block capitalize">
		                                                    Tier: {selectedCustomer.CustomerProfile?.tier || 'Regular'}
		                                                </span>
		                                            </div>
		                                            <button
		                                                onClick={() => setSelectedCustomer(null)}
		                                                className="text-blue-700 hover:text-blue-900 text-sm font-bold"
		                                            >
		                                                Ganti
		                                            </button>
		                                        </div>
		                                    )}
		                                </div>
		                            ) : (
		                                <div className="space-y-3">
		                                    <h2 className="font-bold text-slate-900 flex items-center gap-2">
		                                        <UserIcon size={18} /> Pelanggan Dari Sesi Chat
		                                    </h2>
		                                    {prefillingCustomer && !selectedCustomer ? (
		                                        <p className="text-sm text-slate-500">Memuat data pelanggan dari sesi chat...</p>
		                                    ) : selectedCustomer ? (
		                                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
		                                            <p className="font-bold text-blue-900">{selectedCustomer.name}</p>
		                                            <p className="text-sm text-blue-700">{selectedCustomer.whatsapp_number}</p>
		                                            <span className="text-xs bg-white text-blue-600 px-2 py-0.5 rounded-full border border-blue-200 mt-1 inline-block capitalize">
		                                                Tier: {selectedCustomer.CustomerProfile?.tier || 'Regular'}
		                                            </span>
		                                        </div>
		                                    ) : (
		                                        <p className="text-sm text-rose-600">
		                                            Customer pada sesi chat belum tersedia. Kembali ke inbox chat untuk cek akun customer.
		                                        </p>
		                                    )}
		                                </div>
		                            )}

		                            <div className="h-px bg-slate-200" />

		                            {/* Product Selection */}
		                            <div className="space-y-4">
		                                <h2 className="font-bold text-slate-900 flex items-center gap-2">
		                                    <ShoppingCart size={18} /> Tambah Produk
		                                </h2>
			                                <div className="relative">
			                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
			                                    <input
			                                        type="text"
			                                        placeholder="Cari produk (nama/sku)..."
		                                        className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
		                                        value={productSearch}
		                                        onChange={(e) => setProductSearch(e.target.value)}
		                                        disabled={!selectedCustomer}
		                                    />
		                                    {products.length > 0 && (
		                                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto">
		                                            {products.map(p => (
		                                                <div
		                                                    key={p.id}
		                                                    className="p-3 hover:bg-slate-50 cursor-pointer border-b last:border-0 flex justify-between items-center"
		                                                    onClick={() => addToCart(p)}
		                                                >
		                                                    <div className="flex items-center gap-3">
		                                                        {p.image_url && (
		                                                            <Image src={p.image_url} alt={p.name || 'Produk'} width={40} height={40} className="rounded-lg object-cover" />
			                                                        )}
			                                                        <div>
			                                                            <p className="font-bold text-slate-900">{p.name}</p>
			                                                            <p className="text-xs text-slate-500">SKU: {p.sku || '-'}</p>
			                                                            <p className="text-xs text-slate-500">Stok: {p.stock_quantity}</p>
			                                                        </div>
			                                                    </div>
			                                                    <p className="font-bold text-blue-600">
			                                                        {formatCurrency(getProductPrice(p))}
		                                                    </p>
		                                                </div>
		                                            ))}
		                                        </div>
		                                    )}
			                                    {!selectedCustomer && (
			                                        <p className="text-xs text-amber-600 mt-2 ml-2">
			                                            {isChatDrivenOrder
			                                                ? 'Menunggu data customer dari sesi chat agar harga tier bisa dipakai.'
			                                                : 'Pilih pelanggan dulu untuk melihat harga sesuai tier.'}
			                                        </p>
			                                    )}
			                                </div>
                                            <button
                                                type="button"
                                                onClick={() => setPromoModalOpen(true)}
                                                disabled={!selectedCustomer}
                                                className="btn-3d inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                            >
                                                <Layers size={16} /> Pilih Promo Cepat Habis
                                            </button>
			                                {selectedCustomer ? (
			                                    <CustomerTopProductsCard
			                                        customerId={selectedCustomer.id}
			                                        onPick={addToCart}
			                                    />
		                                ) : null}
		                            </div>

		                            <div className="h-px bg-slate-200" />

		                            {/* Payment & Summary (Admin-only pricing note lives here) */}
		                            <div className="space-y-4">
		                        {canOverridePricing ? (
		                            <div>
		                                <label className="block text-xs font-bold text-slate-500 mb-1">Keterangan Nego (Opsional)</label>
		                                <textarea
	                                    value={orderOverrideReason}
	                                    onChange={(e) => setOrderOverrideReason(e.target.value)}
	                                    className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-sm"
	                                    rows={2}
	                                    placeholder="Mis: harga khusus untuk kenalan / diskon nego..."
	                                />
	                            </div>
	                        ) : null}

	                        <div>
	                            <label className="block text-xs font-bold text-slate-500 mb-1">Metode Pembayaran</label>
	                            <select
	                                value={paymentMethod}
	                                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodUi)}
	                                className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold"
	                            >
	                                <option value="cash_store">Cash (Bayar di Toko)</option>
	                                <option value="transfer_manual">Transfer Bank</option>
	                                <option value="cod">COD (Bayar ditempat)</option>
	                                <option value="follow_driver">Mengikuti Driver (ditentukan saat pengiriman)</option>
	                            </select>
	                            {paymentMethod === 'follow_driver' ? (
	                                <p className="text-[11px] text-slate-500 mt-1">
	                                    Metode pembayaran akan dipilih oleh driver saat pengiriman.
	                                </p>
	                            ) : null}
	                        </div>

	                        <div>
	                            <div className="flex items-center justify-between gap-2 mb-1">
	                                <label className="block text-xs font-bold text-slate-500">Jenis Pengiriman</label>
	                                {canManageShippingConfig ? (
	                                    <Link href="/admin/sales/shipping-methods" className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800">
	                                        Kelola
	                                    </Link>
	                                ) : null}
	                            </div>
	                            <select
	                                value={shippingMethodCode}
	                                onChange={(e) => setShippingMethodCode(e.target.value)}
	                                disabled={loadingShippingMethods || shippingMethods.length === 0}
	                                className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold disabled:opacity-60"
	                            >
	                                {shippingMethods.length === 0 ? (
	                                    <option value="">{loadingShippingMethods ? 'Memuat metode...' : 'Belum ada metode aktif'}</option>
	                        ) : (
	                                    shippingMethods.map((item) => (
	                                        <option key={item.code} value={item.code}>
	                                            {item.name} ({formatCurrency(Number(item.fee || 0))})
	                                        </option>
	                                    ))
	                                )}
	                            </select>
	                        </div>
		                            </div>
		                        </div>
		                    </div>
		                </div>
	
		                {/* Right Column (Lebih luas): Cart Summary */}
		                <div className="order-2 lg:order-2 lg:col-span-2 space-y-6">
	                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-h-[400px] flex flex-col">
                        <h2 className="font-bold text-slate-900 mb-4">Ringkasan Pesanan</h2>

	                        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                            {cart.length === 0 ? (
                                <div className="text-center py-10 text-slate-400">
                                    <ShoppingCart size={48} className="mx-auto mb-2 opacity-20" />
                                    <p>Belum ada produk dipilih</p>
                                </div>
		                            ) : (
		                                cart.map((item) => {
	                                        const name = String(item.product?.name || '').trim() || 'Produk';
	                                        const sku = String(item.product?.sku || '').trim();
	                                        const stockParsed = Number(item.product?.stock_quantity);
                                        const stockQty = Number.isFinite(stockParsed) ? stockParsed : null;
                                        const isOutOfStock = stockQty !== null && stockQty <= 0;
                                        const shortage = stockQty === null ? 0 : Math.max(0, Number(item.qty || 0) - stockQty);
	                                        const hasShortage = shortage > 0;
	                                            const isPromoLine = Boolean(item.clearance_promo_id);
	                                        const dealUnit = getDealUnitPrice(item);
	                                        const normalUnit = getProductPrice(item.product);
	                                        const lineTotal = dealUnit * Number(item.qty || 0);
                                            const autoDiscountPct = (() => {
                                                const tierRaw = selectedCustomer?.CustomerProfile?.tier || 'regular';
                                                const tier = String(tierRaw || 'regular').trim().toLowerCase() === 'premium'
                                                    ? 'platinum'
                                                    : String(tierRaw || 'regular').trim().toLowerCase();

                                                const variant = toObjectOrEmpty(item.product?.varian_harga);
                                                const discounts = toObjectOrEmpty(variant.discounts_pct);
                                                const aliases = tier === 'platinum' ? ['premium'] : [];

                                                const discountCandidates: unknown[] = [
                                                    discounts[tier],
                                                    toObjectOrEmpty(variant[tier]).discount_pct,
                                                    variant[`${tier}_discount_pct`]
                                                ];
                                                for (const alias of aliases) {
                                                    discountCandidates.push(discounts[alias], toObjectOrEmpty(variant[alias]).discount_pct, variant[`${alias}_discount_pct`]);
                                                }
                                                for (const raw of discountCandidates) {
                                                    const parsed = toFiniteNumber(raw);
                                                    if (parsed === null) continue;
                                                    if (parsed <= 0 || parsed > 100) continue;
                                                    return clampPercentage(parsed);
                                                }

                                                const categoryIdRaw = (item.product?.Category && typeof item.product.Category === 'object')
                                                    ? (item.product.Category as { id?: unknown }).id
                                                    : item.product?.category_id;
                                                const categoryId = Number(categoryIdRaw);
                                                if (Number.isInteger(categoryId) && categoryId > 0) {
                                                    const category = categoryDiscountById.get(categoryId);
                                                    const categoryPct = tier === 'platinum'
                                                        ? category?.discount_premium_pct
                                                        : tier === 'gold'
                                                            ? category?.discount_gold_pct
                                                            : tier === 'regular'
                                                                ? category?.discount_regular_pct
                                                                : null;
                                                    if (typeof categoryPct === 'number' && categoryPct > 0) return clampPercentage(categoryPct);
                                                }

                                                const regularUnit = getProductRegularUnitPrice(item.product);
                                                const inferredFromPrice = regularUnit > 0
                                                    ? clampPercentage(Math.round((((regularUnit - normalUnit) / regularUnit) * 100) * 100) / 100)
                                                    : 0;
                                                return inferredFromPrice > 0 ? inferredFromPrice : 0;
                                            })();

                                            const discountInputValue = item.discount_pct_input === undefined
                                                ? (autoDiscountPct > 0 ? String(autoDiscountPct) : '')
                                                : String(item.discount_pct_input || '');
	
	                                        return (
	                                            <div
	                                                key={item.line_id}
	                                                className={`rounded-xl p-3 ${hasShortage
	                                                    ? isOutOfStock
	                                                        ? 'border border-rose-200 bg-rose-50/70'
	                                                        : 'border border-amber-200 bg-amber-50/70'
                                                    : 'border border-slate-100 bg-white'
                                                    }`}
                                            >
	                                                <div className="flex items-start justify-between gap-3">
	                                                    <div className="min-w-0">
	                                                        <div className="flex flex-wrap items-center gap-2">
	                                                            <p className="text-xs font-bold text-slate-900">{name}</p>
                                                                {isPromoLine ? (
                                                                    <span className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                                        Promo Cepat Habis
                                                                    </span>
                                                                ) : null}
	                                                            {stockQty !== null ? (
	                                                                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${isOutOfStock
	                                                                    ? 'bg-rose-600 text-white'
	                                                                    : hasShortage
                                                                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                                                        : 'bg-slate-100 text-slate-700'
                                                                    }`}>
                                                                    {isOutOfStock ? 'Stok Habis' : hasShortage ? 'Stok Kurang' : `Stok ${stockQty}`}
                                                                </span>
	                                                            ) : null}
	                                                        </div>
	                                                        <p className="text-[10px] text-slate-500">SKU: {sku || item.product_id}</p>
                                                            {isPromoLine ? (
                                                                <p className="text-[10px] text-slate-500">
                                                                    Promo: {String(item.clearance_promo?.name || item.clearance_promo_id || '').trim() || '-'}
                                                                </p>
                                                            ) : null}
	                                                        <p className="text-[10px] text-slate-500">
	                                                            Total <span className="font-black text-slate-800">{formatCurrency(lineTotal)}</span>
	                                                            {' • '}
	                                                            Qty {Number(item.qty || 0)}
	                                                            {' • '}
	                                                            Unit {formatCurrency(dealUnit)}
	                                                            {canOverridePricing && !isPromoLine ? ` • Normal ${formatCurrency(normalUnit)}` : ''}
	                                                        </p>

                                                        {stockQty !== null && hasShortage ? (
                                                            <div className={`mt-2 rounded-lg bg-white/80 px-3 py-2 ${isOutOfStock ? 'border border-rose-200' : 'border border-amber-200'}`}>
                                                                <p className={`text-[11px] font-black ${isOutOfStock ? 'text-rose-700' : 'text-amber-700'}`}>
                                                                    Stok {stockQty} • Pesan {Number(item.qty || 0)} • Kurang {shortage}
                                                                </p>
                                                            </div>
                                                        ) : null}

		                                                        {canOverridePricing && !isPromoLine ? (
		                                                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
		                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_128px] sm:items-center">
		                                                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 sm:col-span-1">
		                                                                        Harga deal
		                                                                    </label>
		                                                                    <input
		                                                                        type="text"
		                                                                        inputMode="numeric"
		                                                                        autoComplete="off"
		                                                                        placeholder="-"
		                                                                        value={String(item.unit_price_override_input ?? formatIdrNumber(Number(item.unit_price_override ?? normalUnit) || 0))}
		                                                                        onFocus={() => {
		                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
		                                                                                ? { ...row, unit_price_override_input: String(Math.max(0, Math.trunc(Number(row.unit_price_override ?? normalUnit) || 0))) }
		                                                                                : row));
		                                                                        }}
			                                                                        onBlur={() => {
			                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
			                                                                                ? { ...row, unit_price_override_input: undefined }
			                                                                                : row));
			                                                                        }}
		                                                                        onChange={(e) => {
		                                                                            const raw = e.target.value;
		                                                                            const next = parseIdrInput(raw);
		                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
		                                                                                ? {
                                                                                            ...row,
                                                                                            unit_price_override_input: raw,
                                                                                            unit_price_override: next === null ? null : next,
                                                                                            discount_pct_input: '',
                                                                                            line_total_override_input: undefined,
                                                                                        }
		                                                                                : row));
		                                                                        }}
		                                                                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-right sm:w-32"
		                                                                    />
	                                                                </div>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_128px] sm:items-center">
                                                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                                                        Diskon dipakai (%)
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        autoComplete="off"
                                                                        placeholder="-"
	                                                                        value={discountInputValue}
	                                                                        onChange={(e) => {
	                                                                            const raw = e.target.value;
	                                                                            setCart((prev) => prev.map((row) => {
	                                                                                if (row.line_id !== item.line_id) return row;
	                                                                                if (raw === '') return { ...row, discount_pct_input: '' };

                                                                                const parsed = Number(raw);
                                                                                if (!Number.isFinite(parsed)) return { ...row, discount_pct_input: raw };

                                                                            const pct = clampPercentage(parsed);
                                                                                const regularUnit = getProductRegularUnitPrice(row.product);
                                                                                if (!(regularUnit > 0)) {
                                                                                    return { ...row, discount_pct_input: String(pct) };
                                                                                }

                                                                                const nextUnit = Math.max(0, Math.round(regularUnit * (1 - pct / 100)));
                                                                                return {
                                                                                    ...row,
                                                                                    discount_pct_input: String(pct),
                                                                                    unit_price_override: nextUnit > 0 ? nextUnit : row.unit_price_override ?? null,
                                                                                };
                                                                            }));
                                                                        }}
                                                                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-right sm:w-32"
                                                                    />
                                                                </div>

                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_128px] sm:items-center">
                                                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                                                        Dipakai (total)
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        inputMode="numeric"
                                                                        autoComplete="off"
                                                                        placeholder="-"
                                                                        value={String(item.line_total_override_input ?? formatIdrNumber(Math.max(0, Math.round(lineTotal))))}
                                                                        onFocus={() => {
                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
                                                                                ? { ...row, line_total_override_input: String(Math.max(0, Math.trunc(Math.round(lineTotal)))) }
                                                                                : row));
                                                                        }}
                                                                        onBlur={() => {
                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
                                                                                ? { ...row, line_total_override_input: undefined }
                                                                                : row));
                                                                        }}
                                                                        onChange={(e) => {
                                                                            const raw = e.target.value;
                                                                            const nextTotal = parseIdrInput(raw);
                                                                            const safeTotal = nextTotal === null ? 0 : nextTotal;
                                                                            const qtySafe = Math.max(1, Math.trunc(Number(item.qty || 1)));
                                                                            const nextUnit = Math.max(0, Math.round(safeTotal / qtySafe));

                                                                            setCart((prev) => prev.map((row) => row.line_id === item.line_id
                                                                                ? {
                                                                                    ...row,
                                                                                    line_total_override_input: raw,
                                                                                    unit_price_override: nextUnit > 0 ? nextUnit : null,
                                                                                    discount_pct_input: '',
                                                                                }
                                                                                : row));
                                                                        }}
                                                                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-right sm:w-32"
                                                                    />
                                                                </div>

		                                                                <p className="text-[10px] text-slate-500">
		                                                                    Dipakai <span className="font-black text-slate-800">{formatCurrency(lineTotal)}</span> total • {Number(item.qty || 0)} item
		                                                                </p>
		                                                            </div>
		                                                        ) : null}
		                                                    </div>

	                                                    <div className="text-right">
	                                                        <p className="text-[10px] text-slate-400">Qty</p>
	                                                        <div className="flex items-center justify-end gap-1">
	                                                            <button
	                                                                type="button"
	                                                                onClick={() => updateQty(item.line_id, -1)}
	                                                                disabled={Number(item.qty || 0) <= 1}
	                                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
	                                                                aria-label="Kurangi qty"
                                                            >
                                                                <Minus size={14} />
                                                            </button>
	                                                            <input
	                                                                type="number"
	                                                                min={1}
	                                                                value={Number(item.qty || 0)}
	                                                                onChange={(e) => setQty(item.line_id, e.target.value)}
	                                                                className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-right"
	                                                            />
	                                                            <button
	                                                                type="button"
	                                                                onClick={() => updateQty(item.line_id, 1)}
	                                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
	                                                                aria-label="Tambah qty"
                                                            >
                                                                <Plus size={14} />
                                                            </button>
                                                        </div>

                                                        <div className="mt-2 flex items-center justify-end gap-2">
                                                            {canManageAliases ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setAliasModalProduct({ id: item.product_id, sku: item.product?.sku, name: item.product?.name });
                                                                        setAliasModalOpen(true);
                                                                    }}
                                                                    className="btn-3d rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
                                                                >
                                                                    Alias
                                                                </button>
                                                            ) : null}
	                                                            <button
	                                                                type="button"
	                                                                onClick={() => removeFromCart(item.line_id)}
	                                                                className="btn-3d inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
	                                                                aria-label="Hapus dari cart"
	                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
	                            )}
			                        </div>

                                <div className="border-t border-slate-200 pt-4 space-y-3">
                                    <div className="space-y-1 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="font-semibold text-slate-600">Subtotal Produk</span>
                                            <span className="font-black text-slate-900">{formatCurrency(calculateSubtotal())}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="font-semibold text-slate-600">Biaya Pengiriman</span>
                                            <span className="font-black text-slate-900">{formatCurrency(shippingFee)}</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center text-lg">
                                        <span className="font-bold text-slate-600">Total</span>
                                        <span className="font-black text-slate-900">{formatCurrency(grandTotal)}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleSubmit}
                                        disabled={submitting || cart.length === 0 || (shippingMethods.length > 0 && !shippingMethodCode)}
                                        className="btn-3d w-full rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                                    >
                                        {submitting ? 'Memproses...' : (
                                            <>
                                                <Check size={18} /> Buat Pesanan
                                            </>
                                        )}
                                    </button>
                                </div>
		                    </div>
		                </div>
		            </div>

                    <ProductAliasModal
                        open={aliasModalOpen}
                        onClose={() => setAliasModalOpen(false)}
                        product={aliasModalProduct}
                    />

	                    {submitConfirmOpen && (
	                        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4 pb-28 sm:p-6">
	                            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
	                                <div className="border-b border-slate-200 px-5 pb-4 pt-5">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Konfirmasi</p>
                                    <h3 className="mt-2 text-lg font-black text-slate-900">Buat pesanan ini?</h3>
                                    <p className="mt-1 text-xs text-slate-500">Periksa ringkasan sebelum lanjut.</p>
                                </div>

                                <div className="px-5 py-4 space-y-3 text-sm text-slate-700">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs font-bold text-slate-500">Customer</span>
                                            <span className="text-right font-black text-slate-900">{selectedCustomer?.name || '-'}</span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs font-bold text-slate-500">Item</span>
                                            <span className="text-right font-black text-slate-900">
                                                {cart.reduce((sum, row) => sum + Number(row.qty || 0), 0)}
                                            </span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs font-bold text-slate-500">Total</span>
                                            <span className="text-right font-black text-slate-900">{formatCurrency(grandTotal)}</span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs font-bold text-slate-500">Pembayaran</span>
                                            <span className="text-right font-bold text-slate-700">
                                                {paymentMethod === 'follow_driver'
                                                    ? 'Mengikuti Driver'
                                                    : paymentMethod === 'cash_store'
                                                        ? 'Cash (Bayar di Toko)'
                                                        : paymentMethod === 'transfer_manual'
                                                            ? 'Transfer Bank'
                                                            : 'COD (Bayar ditempat)'}
                                            </span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs font-bold text-slate-500">Pengiriman</span>
                                            <span className="text-right font-bold text-slate-700">
                                                {shippingMethods.find((m) => String(m.code) === String(shippingMethodCode))?.name || shippingMethodCode || '-'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSubmitConfirmOpen(false)}
                                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                        disabled={submitting}
                                    >
                                        Batal
                                    </button>
                                    <button
                                        type="button"
                                        onClick={submitOrder}
                                        className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                        disabled={submitting}
                                    >
                                        {submitting ? 'Memproses...' : 'Ya, Buat Pesanan'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

	        </div>
	    );
}

export default function ManualOrderPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading order form...</div>}>
            <ManualOrderContent />
        </Suspense>
    );
}
