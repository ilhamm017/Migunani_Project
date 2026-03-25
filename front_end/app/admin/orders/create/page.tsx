'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, Trash2, ShoppingCart, User as UserIcon, Check, MessageSquare, Paperclip, SendHorizontal } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import Image from 'next/image';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';

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
    name?: string;
    image_url?: string;
    stock_quantity?: number | string;
    price?: number | string;
    base_price?: number | string;
    varian_harga?: unknown;
};

type CartItem = {
    product_id: string;
    product: ProductOption;
    qty: number;
    unit_price_override?: number | null;
    unit_price_override_reason?: string;
};

type PaymentMethodUi = 'transfer_manual' | 'cod' | 'cash_store' | 'follow_driver';

type SubmitPopupTone = 'success' | 'error' | 'info';
type SubmitPopupState = {
    tone: SubmitPopupTone;
    title: string;
    message: string;
} | null;

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

    const [submitPopup, setSubmitPopup] = useState<SubmitPopupState>(null);
    const submitPopupTimerRef = useRef<number | null>(null);
    const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

    const dismissSubmitPopup = useCallback(() => {
        setSubmitPopup(null);
        if (submitPopupTimerRef.current) {
            window.clearTimeout(submitPopupTimerRef.current);
            submitPopupTimerRef.current = null;
        }
    }, []);

    const showSubmitPopup = useCallback((tone: SubmitPopupTone, title: string, message: string, ttlMs = 4500) => {
        setSubmitPopup({ tone, title, message });
        if (submitPopupTimerRef.current) {
            window.clearTimeout(submitPopupTimerRef.current);
        }
        submitPopupTimerRef.current = window.setTimeout(() => {
            setSubmitPopup(null);
            submitPopupTimerRef.current = null;
        }, ttlMs);
    }, []);

    useEffect(() => {
        return () => {
            if (submitPopupTimerRef.current) {
                window.clearTimeout(submitPopupTimerRef.current);
                submitPopupTimerRef.current = null;
            }
        };
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
                alert('Customer tidak aktif. Order tidak bisa dibuat.');
            } catch (error: unknown) {
                const statusCode = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
                if (statusCode === 404) {
                    if (isChatDrivenOrder) {
                        const resolved = await tryResolveCustomerFromChatSession();
                        if (resolved) return;
                        alert('Customer pada sesi chat belum terdaftar. Tombol Buat Order hanya untuk customer terdaftar.');
                    } else {
                        alert('Customer tidak ditemukan.');
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
                    const res = await api.admin.inventory.getProducts({ search: productSearch, limit: 10, status: 'active' });
                    setProducts(res.data.products);
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

    const toFiniteNumber = (value: unknown): number | null => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return parsed;
    };

    const getProductPrice = (product: ProductOption) => {
        const tierRaw = selectedCustomer?.CustomerProfile?.tier || 'regular';
        const tier = String(tierRaw || 'regular').trim().toLowerCase() === 'premium'
            ? 'platinum'
            : String(tierRaw || 'regular').trim().toLowerCase();

        const variant = toObjectOrEmpty(product.varian_harga);
        const prices = toObjectOrEmpty(variant.prices);

        const basePriceRaw = Number(product.price || 0);
        const basePrice = Number.isFinite(basePriceRaw) && basePriceRaw > 0
            ? basePriceRaw
            : Number(prices.regular || variant.regular || prices.base_price || variant.base_price || 0) || 0;

        const normalizedBasePrice = Math.max(0, basePrice);
        if (tier === 'regular') return normalizedBasePrice;

        const discounts = toObjectOrEmpty(variant.discounts_pct);
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
            if (directPrice !== null) return Math.max(0, directPrice);
        }

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
            if (discountPct === null || discountPct < 0 || discountPct > 100) continue;
            return Math.max(0, Math.round((normalizedBasePrice * (1 - discountPct / 100)) * 100) / 100);
        }

	        return normalizedBasePrice;
	    };

		    const getDealUnitPrice = (item: CartItem) => {
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
		            const existing = prev.find(item => item.product_id === product.id);
	            if (existing) {
	                return prev.map(item => item.product_id === product.id ? { ...item, qty: item.qty + 1 } : item);
	            }
	            const baseline = getProductPrice(product);
	            return [...prev, { product_id: product.id, product, qty: 1, unit_price_override: baseline, unit_price_override_reason: '' }];
	        });
	        setProductSearch('');
	        setProducts([]);
	    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product_id !== productId));
    };

    const updateQty = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.product_id === productId) {
                const newQty = Math.max(1, item.qty + delta);
                return { ...item, qty: newQty };
            }
            return item;
        }));
    };

	    const calculateSubtotal = () => {
	        return cart.reduce((sum, item) => sum + (getDealUnitPrice(item) * item.qty), 0);
	    };

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
	                customer_id: selectedCustomer.id, // Only works if admin
	                items: cart.map(item => {
	                    const baseline = Math.max(0, getProductPrice(item.product));
	                    const deal = Math.max(0, getDealUnitPrice(item));
	                    const itemReason = String(item.unit_price_override_reason || '').trim();
	                    return {
	                        product_id: item.product.id,
	                        qty: item.qty,
	                        ...(canOverridePricing && deal > 0 && deal < baseline ? { unit_price_override: deal } : {}),
	                        ...(canOverridePricing && itemReason ? { unit_price_override_reason: itemReason } : {})
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

		            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
		                {/* Left Column: Selection (digabung jadi 1 card) */}
		                <div className="order-2 lg:order-2 lg:col-span-1">
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

	                        <div className="space-y-1 text-sm">
	                            <div className="flex justify-between items-center">
	                                <span className="font-semibold text-slate-600">Subtotal Produk</span>
	                                <span className="font-bold text-slate-900">{formatCurrency(calculateSubtotal())}</span>
	                            </div>
	                            <div className="flex justify-between items-center">
	                                <span className="font-semibold text-slate-600">Biaya Pengiriman</span>
	                                <span className="font-bold text-slate-900">{formatCurrency(shippingFee)}</span>
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
			                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
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
	
		                {/* Right Column (Lebih luas): Cart Summary */}
		                <div className="order-1 lg:order-1 lg:col-span-2 space-y-6">
	                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-h-[400px] flex flex-col">
                        <h2 className="font-bold text-slate-900 mb-4">Ringkasan Pesanan</h2>

	                        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
                            {cart.length === 0 ? (
                                <div className="text-center py-10 text-slate-400">
                                    <ShoppingCart size={48} className="mx-auto mb-2 opacity-20" />
                                    <p>Belum ada produk dipilih</p>
                                </div>
	                            ) : (
	                                cart.map(item => (
	                                    <div key={item.product_id} className="flex gap-3 relative group">
	                                        <div className="flex-1">
	                                            <p className="text-sm font-bold text-slate-900 line-clamp-1">{item.product.name}</p>
	                                            <div className="mt-1 space-y-1">
		                                                <p className="text-sm text-slate-500">
		                                                    Harga normal {formatCurrency(getProductPrice(item.product))} x {item.qty}
		                                                </p>
		                                                {canOverridePricing ? (
		                                                    <div className="flex flex-wrap items-center gap-2">
		                                                        <label className="text-xs font-bold text-slate-500">Harga deal</label>
		                                                        <input
		                                                            type="number"
		                                                            min={0}
		                                                            value={Number(item.unit_price_override ?? getProductPrice(item.product)) || 0}
	                                                            onChange={(e) => {
	                                                                const raw = e.target.value;
	                                                                const next = raw === '' ? null : Number(raw);
	                                                                setCart((prev) => prev.map((row) => row.product_id === item.product_id
	                                                                    ? { ...row, unit_price_override: Number.isFinite(Number(next)) ? Number(next) : null }
	                                                                    : row));
	                                                            }}
		                                                            className="w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-right"
		                                                        />
		                                                        <input
		                                                            type="text"
		                                                            placeholder="Keterangan (opsional)"
	                                                            value={String(item.unit_price_override_reason || '')}
	                                                            onChange={(e) => {
	                                                                const next = e.target.value;
	                                                                setCart((prev) => prev.map((row) => row.product_id === item.product_id
	                                                                    ? { ...row, unit_price_override_reason: next }
	                                                                    : row));
	                                                            }}
		                                                            className="flex-1 min-w-[180px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm"
		                                                        />
		                                                    </div>
		                                                ) : null}
		                                                {canOverridePricing ? (
		                                                    <p className="text-xs text-slate-500">
		                                                        Dipakai: <span className="font-bold">{formatCurrency(getDealUnitPrice(item))}</span> per item
		                                                    </p>
		                                                ) : null}
	                                            </div>
	                                        </div>
	                                        <div className="flex items-center gap-2">
	                                            <button onClick={() => updateQty(item.product_id, -1)} className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200">-</button>
	                                            <span className="text-sm font-bold w-4 text-center">{item.qty}</span>
	                                            <button onClick={() => updateQty(item.product_id, 1)} className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200">+</button>
	                                        </div>
                                        <button
                                            onClick={() => removeFromCart(item.product_id)}
                                            className="text-rose-500 hover:text-rose-700 p-1"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
	                            )}
			                        </div>
		                    </div>
		                </div>
		            </div>

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

                    {submitPopup && (
                        <button
                            type="button"
                            onClick={dismissSubmitPopup}
                            className={`fixed right-4 bottom-[calc(var(--admin-bottom-nav-height,5rem)+1rem)] z-[80] w-[min(92vw,360px)] rounded-xl border px-4 py-3 text-left shadow-lg ${submitPopup.tone === 'success'
                                ? 'border-emerald-300 bg-emerald-50'
                                : submitPopup.tone === 'error'
                                    ? 'border-rose-300 bg-rose-50'
                                    : 'border-slate-200 bg-white'
                                }`}
                        >
                            <p className={`text-[11px] font-black uppercase tracking-widest ${submitPopup.tone === 'success'
                                ? 'text-emerald-700'
                                : submitPopup.tone === 'error'
                                    ? 'text-rose-700'
                                    : 'text-slate-600'
                                }`}
                            >
                                {submitPopup.title}
                            </p>
                            <p className={`text-xs font-semibold mt-1 ${submitPopup.tone === 'success'
                                ? 'text-emerald-700'
                                : submitPopup.tone === 'error'
                                    ? 'text-rose-700'
                                    : 'text-slate-700'
                                }`}
                            >
                                {submitPopup.message}
                            </p>
                        </button>
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
