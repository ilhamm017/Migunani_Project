'use client';

import Link from 'next/link';
import { ShoppingCart, Package, ArrowRight, Trash2, Plus, Minus } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { formatCurrency } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

type ApiCartProduct = {
    id: string;
    name?: string;
    price?: number;
    effective_price?: number;
    effective_discount_pct?: number;
    effective_discount_source?: string;
    image_url?: string | null;
};

type ApiCartItem = {
    id: string | number;
    product_id: string;
    qty: number;
    Product?: ApiCartProduct;
};

export default function CartPage() {
    const { items, totalItems, totalPrice, removeItem, updateItem, setCart } = useCartStore();
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState('');

    const mapApiItems = (rawItems: ApiCartItem[]): Parameters<typeof setCart>[0] => {
        return rawItems
            .map((row) => {
                const productId = String(row?.product_id || '').trim();
                if (!productId) return null;
                const qty = Math.max(1, Math.trunc(Number(row?.qty || 0)));
                const product = row?.Product;

                const basePrice = Number(product?.price || 0);
                const effectivePriceRaw = Number(product?.effective_price);
                const effectivePrice = Number.isFinite(effectivePriceRaw) && effectivePriceRaw > 0 ? effectivePriceRaw : null;
                const discountPctRaw = Number(product?.effective_discount_pct);
                const discountPct = Number.isFinite(discountPctRaw) && discountPctRaw > 0 ? discountPctRaw : undefined;

                const finalPrice = effectivePrice ?? basePrice;
                const originalPrice = effectivePrice !== null && basePrice > 0 && effectivePrice < basePrice ? basePrice : undefined;
                const discountSourceRaw = typeof product?.effective_discount_source === 'string'
                    ? String(product.effective_discount_source).trim()
                    : '';
                const discountSource = discountSourceRaw ? discountSourceRaw : undefined;

                return {
                    id: productId,
                    cartItemId: String(row?.id ?? ''),
                    productId,
                    productName: String(product?.name || ''),
                    price: Number(finalPrice || 0),
                    ...(originalPrice !== undefined ? { originalPrice } : {}),
                    ...(discountPct !== undefined ? { discountPct } : {}),
                    ...(discountSource !== undefined ? { discountSource } : {}),
                    quantity: qty,
                    imageUrl: product?.image_url ? String(product.image_url) : undefined,
                };
            })
            .filter(Boolean) as Parameters<typeof setCart>[0];
    };

    const subtotalBeforeDiscount = useMemo(() => {
        return items.reduce((sum, item) => {
            const base = Number(item.originalPrice ?? item.price ?? 0);
            const qty = Math.max(0, Math.trunc(Number(item.quantity || 0)));
            return sum + base * qty;
        }, 0);
    }, [items]);

    const totalSavings = useMemo(() => {
        const savings = subtotalBeforeDiscount - totalPrice;
        if (!Number.isFinite(savings) || savings <= 0) return 0;
        return Math.round(savings * 100) / 100;
    }, [subtotalBeforeDiscount, totalPrice]);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        const load = async () => {
            try {
                setSyncError('');
                setSyncing(true);
                const res = await api.cart.getCart();
                const cart = res.data;

                const rawItems: ApiCartItem[] = Array.isArray(cart?.CartItems)
                    ? cart.CartItems
                    : Array.isArray(cart?.items)
                        ? cart.items
                        : [];

                const mapped = mapApiItems(rawItems);

                if (!cancelled) {
                    setCart(mapped);
                }
            } catch (error) {
                console.error('Failed to sync cart from backend:', error);
                if (!cancelled) setSyncError('Gagal sinkronisasi keranjang dari server.');
            } finally {
                if (!cancelled) setSyncing(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, setCart]);

    const syncUpdateQty = async (productId: string, nextQty: number) => {
        const normalizedQty = Math.max(1, Math.trunc(Number(nextQty) || 1));
        const target = items.find((item) => item.productId === productId);
        updateItem(productId, normalizedQty);

        if (!isAuthenticated) return;
        const cartItemId = String(target?.cartItemId || '').trim();
        if (!cartItemId) return;

        try {
            setSyncError('');
            await api.cart.updateCartItem(cartItemId, normalizedQty);
        } catch (error) {
                console.error('Failed to sync cart qty:', error);
                setSyncError('Gagal menyimpan perubahan keranjang. Memuat ulang data server...');
            try {
                const res = await api.cart.getCart();
                const cart = res.data;
                const rawItems: ApiCartItem[] = Array.isArray(cart?.CartItems)
                    ? cart.CartItems
                    : Array.isArray(cart?.items)
                        ? cart.items
                        : [];
                const mapped = mapApiItems(rawItems);
                setCart(mapped);
            } catch (reloadError) {
                console.error('Failed to reload cart after sync failure:', reloadError);
            }
        }
    };

    const syncRemoveItem = async (productId: string) => {
        const target = items.find((item) => item.productId === productId);
        removeItem(productId);

        if (!isAuthenticated) return;
        const cartItemId = String(target?.cartItemId || '').trim();
        if (!cartItemId) return;

        try {
            setSyncError('');
            await api.cart.removeCartItem(cartItemId);
        } catch (error) {
                console.error('Failed to remove item from backend cart:', error);
                setSyncError('Gagal menghapus item. Memuat ulang data server...');
            try {
                const res = await api.cart.getCart();
                const cart = res.data;
                const rawItems: ApiCartItem[] = Array.isArray(cart?.CartItems)
                    ? cart.CartItems
                    : Array.isArray(cart?.items)
                        ? cart.items
                        : [];
                const mapped = mapApiItems(rawItems);
                setCart(mapped);
            } catch (reloadError) {
                console.error('Failed to reload cart after remove failure:', reloadError);
            }
        }
    };

    return (
        <div className="p-6 space-y-6">
            {/* Section Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Keranjang Belanja</h3>
                <div className="flex items-center gap-2">
                    {syncing && isAuthenticated ? (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                            Sinkronisasi...
                        </span>
                    ) : null}
                    {totalItems > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                            {totalItems} Item
                        </span>
                    )}
                </div>
            </div>

            {syncError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                    <p className="text-[11px] font-bold text-amber-800">{syncError}</p>
                </div>
            ) : null}

            {totalItems === 0 ? (
                /* Empty State */
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                        <ShoppingCart size={32} className="text-slate-300" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900 mb-1">Keranjang Kosong</h2>
                    <p className="text-[11px] text-slate-400 mb-6 text-center">
                        Belum ada produk di keranjang. Mulai belanja sekarang!
                    </p>
                    <Link href="/catalog">
                        <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-emerald-200 active:scale-95 transition-all">
                            <Package size={14} className="inline mr-2" />
                            Lihat Katalog
                        </button>
                    </Link>
                </div>
            ) : (
                /* Cart Items */
                <div className="space-y-3">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="bg-white p-4 rounded-3xl border border-slate-100 flex items-center gap-4 shadow-sm"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0">
                                <Package size={22} className="text-slate-300" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold text-slate-900 truncate">{item.productName}</h4>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <p className="text-[11px] font-black text-emerald-600">{formatCurrency(item.price)}</p>
                                    {Number.isFinite(Number(item.originalPrice)) && Number(item.originalPrice) > Number(item.price) ? (
                                        <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg">
                                            Diskon {(() => {
                                                const rawPct = Number(item.discountPct);
                                                const pct = Number.isFinite(rawPct) && rawPct > 0
                                                    ? rawPct
                                                    : Number(item.originalPrice) > 0
                                                        ? ((Number(item.originalPrice) - Number(item.price)) / Number(item.originalPrice)) * 100
                                                        : 0;
                                                const rounded = Math.round(pct * 10) / 10;
                                                const text = rounded.toFixed(1).replace(/\.0$/, '');
                                                return `${text}%`;
                                            })()}
                                        </span>
                                    ) : null}
                                </div>
                                {Number.isFinite(Number(item.originalPrice)) && Number(item.originalPrice) > Number(item.price) ? (
                                    <p className="text-[10px] font-bold text-slate-500">
                                        <span className="line-through text-slate-400">{formatCurrency(Number(item.originalPrice))}</span>
                                        <span className="mx-1">•</span>
                                        Potongan {formatCurrency(Math.max(0, (Number(item.originalPrice) - Number(item.price)) * Number(item.quantity || 0)))}
                                    </p>
                                ) : null}
                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        onClick={() => void syncUpdateQty(item.productId, Math.max(1, item.quantity - 1))}
                                        className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 active:scale-90 transition-all"
                                    >
                                        <Minus size={12} />
                                    </button>
                                    <span className="text-[10px] font-black w-6 text-center">{item.quantity}</span>
                                    <button
                                        onClick={() => void syncUpdateQty(item.productId, item.quantity + 1)}
                                        className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 active:scale-90 transition-all"
                                    >
                                        <Plus size={12} />
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => void syncRemoveItem(item.productId)}
                                className="p-2 rounded-xl text-rose-400 hover:bg-rose-50 transition-all"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}

                    {/* Total Section */}
                    <div className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl mt-4">
                        {totalSavings > 0 ? (
                            <div className="space-y-1 mb-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase tracking-widest opacity-50">Subtotal</span>
                                    <span className="text-xs font-bold opacity-60 line-through">
                                        {formatCurrency(subtotalBeforeDiscount)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase tracking-widest opacity-50">Potongan</span>
                                    <span className="text-xs font-black text-emerald-300">- {formatCurrency(totalSavings)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-2">
                                    <span className="text-xs font-bold uppercase tracking-widest opacity-50">Total</span>
                                    <span className="text-xl font-black">{formatCurrency(totalPrice)}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-xs font-bold uppercase tracking-widest opacity-50">Total</span>
                                <span className="text-xl font-black">{formatCurrency(totalPrice)}</span>
                            </div>
                        )}
                        <Link href="/checkout">
                            <button className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl text-xs uppercase shadow-lg shadow-emerald-800/30 active:scale-95 transition-all">
                                Checkout Sekarang
                                <ArrowRight size={14} className="inline ml-2" />
                            </button>
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
