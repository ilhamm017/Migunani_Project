'use client';

import Link from 'next/link';
import { ShoppingCart, Package, ArrowRight, Trash2, Plus, Minus } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { formatCurrency } from '@/lib/utils';

export default function CartPage() {
    const { items, totalItems, totalPrice, removeItem, updateItem } = useCartStore();

    return (
        <div className="p-6 space-y-6">
            {/* Section Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Keranjang Belanja</h3>
                {totalItems > 0 && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                        {totalItems} Item
                    </span>
                )}
            </div>

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
                                <p className="text-[11px] font-black text-emerald-600 mt-0.5">{formatCurrency(item.price)}</p>
                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        onClick={() => updateItem(item.id, Math.max(1, item.quantity - 1))}
                                        className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 active:scale-90 transition-all"
                                    >
                                        <Minus size={12} />
                                    </button>
                                    <span className="text-[10px] font-black w-6 text-center">{item.quantity}</span>
                                    <button
                                        onClick={() => updateItem(item.id, item.quantity + 1)}
                                        className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 active:scale-90 transition-all"
                                    >
                                        <Plus size={12} />
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => removeItem(item.id)}
                                className="p-2 rounded-xl text-rose-400 hover:bg-rose-50 transition-all"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}

                    {/* Total Section */}
                    <div className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl mt-4">
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-xs font-bold uppercase tracking-widest opacity-50">Total</span>
                            <span className="text-xl font-black">{formatCurrency(totalPrice)}</span>
                        </div>
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
