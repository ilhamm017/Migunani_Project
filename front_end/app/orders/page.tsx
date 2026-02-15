'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, ShoppingBag, ArrowRight, Clock, CheckCircle2, Truck, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const getOrderListVisual = (status: string) => {
    if (['completed', 'delivered'].includes(status)) {
        return {
            className: 'bg-emerald-50 text-emerald-600',
            icon: CheckCircle2,
            label: 'Selesai'
        };
    }
    if (status === 'shipped') {
        return {
            className: 'bg-blue-50 text-blue-600',
            icon: Truck,
            label: 'Dikirim'
        };
    }
    if (status === 'waiting_payment') {
        return {
            className: 'bg-amber-50 text-amber-600',
            icon: Clock,
            label: 'Verifikasi Bayar'
        };
    }
    if (status === 'debt_pending') {
        return {
            className: 'bg-amber-50 text-amber-700',
            icon: Clock,
            label: 'Utang Belum Lunas'
        };
    }
    if (status === 'pending') {
        return {
            className: 'bg-orange-50 text-orange-600',
            icon: Clock,
            label: 'Menunggu Bayar'
        };
    }

    return {
        className: 'bg-slate-100 text-slate-600',
        icon: Clock,
        label: 'Diproses'
    };
};

export default function OrdersPage() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            setOrders([]);
            setLoading(false);
            return;
        }

        const load = async () => {
            try {
                const res = await api.orders.getMyOrders({ page: 1, limit: 20 });
                setOrders(res.data?.orders || []);
            } catch (error) {
                console.error('Failed to load orders:', error);
                setOrders([]);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [isAuthenticated]);

    if (loading) {
        return (
            <div className="p-6">
                <p className="text-sm text-slate-500">Memuat pesanan...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="p-6 space-y-6">
                <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Pesanan Saya</h3>
                </div>

                <div className="bg-white border border-slate-100 rounded-[28px] p-6 shadow-sm space-y-4">
                    <h2 className="text-lg font-black text-slate-900">Login untuk melihat riwayat pesanan</h2>
                    <p className="text-sm text-slate-500">
                        Anda sedang sebagai tamu. Masuk atau daftar untuk melacak status pesanan Anda.
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Link href="/auth/login" className="h-11 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide inline-flex items-center justify-center active:scale-95 transition-all">
                            Login
                        </Link>
                        <Link href="/auth/register" className="h-11 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-black uppercase tracking-wide inline-flex items-center justify-center active:scale-95 transition-all">
                            Register
                        </Link>
                    </div>
                </div>

                <Link href="/catalog">
                    <button className="w-full py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase active:scale-95 transition-all">
                        <ShoppingBag size={14} className="inline mr-2" />
                        Lanjut Belanja sebagai Tamu
                    </button>
                </Link>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Section Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Pesanan Saya</h3>
                {orders.length > 0 && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                        {orders.length} Pesanan
                    </span>
                )}
            </div>

            {orders.length === 0 ? (
                /* Empty State */
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                        <Package size={32} className="text-slate-300" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900 mb-1">Belum Ada Pesanan</h2>
                    <p className="text-[11px] text-slate-400 mb-6 text-center">
                        Anda belum memiliki riwayat pesanan. Mulai berbelanja sekarang!
                    </p>
                    <Link href="/catalog">
                        <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-emerald-200 active:scale-95 transition-all">
                            <ShoppingBag size={14} className="inline mr-2" />
                            Mulai Belanja
                        </button>
                    </Link>
                </div>
            ) : (
                /* Order List */
                <div className="space-y-3">
                    {orders.map((order: any) => {
                        const visual = getOrderListVisual(order.status);
                        const StatusIcon = visual.icon;

                        return (
                            <Link
                                key={order.id}
                                href={`/orders/${order.id}`}
                                className="bg-white p-4 rounded-3xl border border-slate-100 flex items-center gap-4 active:scale-95 transition-all shadow-sm"
                            >
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${visual.className}`}>
                                    <StatusIcon size={22} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{order.id}</p>
                                        {order.Returs && order.Returs.length > 0 && (
                                            <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-lg">
                                                <RotateCcw size={8} />
                                                <span className="text-[8px] font-black uppercase">Retur</span>
                                            </div>
                                        )}
                                    </div>
                                    <h4 className="text-xs font-bold text-slate-900">Invoice: {order.Invoice?.invoice_number || '-'}</h4>
                                    <p className="text-[10px] font-bold text-slate-500 mt-0.5">{visual.label}</p>
                                    <p className="text-[11px] font-black text-slate-900 mt-1">{formatCurrency(Number(order.total_amount || 0))}</p>
                                </div>
                                <ArrowRight size={16} className="text-slate-300" />
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Quick Info Section */}
            <section className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl">
                <h3 className="text-xs font-bold uppercase tracking-widest opacity-50 mb-4">Info Pesanan</h3>
                <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                            <Clock size={20} />
                        </div>
                        <span className="text-[9px] font-bold text-center">Diproses</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                            <Truck size={20} />
                        </div>
                        <span className="text-[9px] font-bold text-center">Dikirim</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                            <CheckCircle2 size={20} />
                        </div>
                        <span className="text-[9px] font-bold text-center">Selesai</span>
                    </div>
                </div>
            </section>
        </div>
    );
}
