'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
    ChevronLeft, List, Clock,
    Package, Truck, CheckCircle2, ChevronDown,
    ChevronRight, ChevronsLeft, ChevronsRight,
    Search, RotateCcw
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

const TABS = [
    { id: 'all', label: 'By No Order', icon: List },
    { id: 'processing', label: 'Proses Order', icon: Search },
    { id: 'ready_to_ship', label: 'Persiapan Barang', icon: Package },
    { id: 'shipped', label: 'Dalam Pengiriman', icon: Clock },
    { id: 'delivered', label: 'Terkirim', icon: Package },
];

const getStatusLabel = (status: string) => {
    const statuses: Record<string, string> = {
        'pending': 'Menunggu Konfirmasi',
        'waiting_invoice': 'Menunggu Invoice',
        'waiting_payment': 'Diproses',
        'ready_to_ship': 'Diproses',
        'allocated': 'Dialokasikan',
        'partially_fulfilled': 'Terkirim Sebagian',
        'debt_pending': 'Utang Belum Lunas',
        'shipped': 'Dikirim',
        'delivered': 'Selesai',
        'completed': 'Selesai',
        'canceled': 'Dibatalkan',
        'expired': 'Kedaluwarsa',
        'hold': 'Ditahan',
        'waiting_admin_verification': 'Verifikasi Pembayaran'
    };
    return statuses[status] || status;
};

const getStatusColor = (status: string) => {
    if (['completed', 'delivered'].includes(status)) return 'bg-emerald-500 text-white';
    if (status === 'shipped') return 'bg-blue-500 text-white';
    if (status === 'partially_fulfilled') return 'bg-amber-500 text-white';
    if (['debt_pending', 'waiting_admin_verification'].includes(status)) return 'bg-indigo-500 text-white';
    if (status === 'pending') return 'bg-orange-500 text-white';
    return 'bg-slate-500 text-white';
};

export default function OrdersPage() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    const loadOrders = useCallback(async () => {
        if (!isAuthenticated) {
            setOrders([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const statusFilter = activeTab === 'all' ? undefined : activeTab;
            const res = await api.orders.getMyOrders({ page, limit: 10, status: statusFilter });
            setOrders(res.data?.orders || []);
            setTotalPages(res.data?.totalPages || 1);
        } catch (error) {
            console.error('Failed to load orders:', error);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, activeTab, page]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    useRealtimeRefresh({
        enabled: isAuthenticated,
        onRefresh: loadOrders,
        domains: ['order', 'retur', 'admin'],
        pollIntervalMs: 15000,
    });

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <Clock size={40} className="text-slate-300" />
                </div>
                <h2 className="text-xl font-black text-slate-800 mb-2">Login Diperlukan</h2>
                <p className="text-slate-500 mb-6 max-w-xs">Silakan login untuk dapat melihat riwayat pesanan Anda.</p>
                <Link href="/auth/login" className="w-full max-w-xs bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-100">
                    Login Sekarang
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white pb-20">
            {/* Header */}
            <div className="p-6 space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/profile" className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 active:scale-95 transition-all">
                        <ChevronLeft size={24} />
                    </Link>
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Pesanan Saya</h3>
                        <h1 className="text-xl font-black text-slate-900">Riwayat Belanja</h1>
                    </div>
                </div>

                {/* Redefine Search Button */}
                <button className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wide shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                    <Search size={18} />
                    Redefine Search
                </button>
            </div>

            {/* Status Tabs */}
            <div className="px-6 pb-4 overflow-x-auto no-scrollbar">
                <div className="flex gap-3 min-w-max">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setPage(1); }}
                                className={`flex flex-col items-center justify-center w-28 h-28 rounded-3xl transition-all border ${isActive ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-white border-slate-100 text-slate-400'}`}
                            >
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${isActive ? 'bg-white/20' : 'bg-emerald-50 text-emerald-600'}`}>
                                    <Icon size={24} />
                                </div>
                                <span className="text-[10px] font-black text-center leading-tight px-2 uppercase tracking-tight">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Order List */}
            <div className="p-6 space-y-4">
                {loading && page === 1 ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-slate-50 rounded-3xl h-56 animate-pulse" />
                        ))}
                    </div>
                ) : orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                            <Package size={32} className="text-slate-300" />
                        </div>
                        <p className="text-slate-400 font-bold">Tidak ada pesanan ditemukan</p>
                    </div>
                ) : (
                    orders.map((order) => (
                        <div key={order.id} className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden p-6 space-y-5">
                            {/* Top Row */}
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <p className="text-xs font-black text-slate-900 uppercase tracking-widest">{order.id}</p>
                                    <p className="text-[11px] font-bold text-slate-400">: {formatDate(order.createdAt)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-400">30 days after invoice date</p>
                                    <div className="flex items-center justify-end gap-1 mt-1">
                                        {order.parent_order_id && (
                                            <span className="inline-block bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg">Backorder</span>
                                        )}
                                        {order.Returs && order.Returs.length > 0 && (
                                            <span className="inline-block bg-amber-50 text-amber-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg">Retur</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Summary & Status */}
                            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 shadow-sm">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Order</p>
                                        <p className="text-sm font-black text-slate-900">{order.total_qty || 0} Pcs</p>
                                    </div>
                                </div>
                                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider ${getStatusColor(order.status)} shadow-sm`}>
                                    {getStatusLabel(order.status)}
                                </div>
                            </div>

                            {/* Divider & Details Icon */}
                            <div className="flex items-center justify-center text-emerald-500">
                                <ChevronDown size={24} className="animate-bounce" />
                            </div>

                            {/* Secondary Counts */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 p-4 rounded-2xl">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Proses Indent</p>
                                    <p className="text-lg font-black text-slate-900">{order.indent_qty || 0}</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-2xl">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Terkirim</p>
                                    <p className="text-lg font-black text-slate-900">{order.shipped_qty || 0}</p>
                                </div>
                            </div>

                            {/* Details Button */}
                            <Link href={`/orders/${order.id}`} className="block">
                                <button className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-slate-200 active:scale-95 transition-all">
                                    Lihat Detail Pesanan
                                </button>
                            </Link>
                        </div>
                    ))
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="px-6 py-8 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(1)}
                            className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all shadow-sm"
                        >
                            <ChevronsLeft size={16} />
                        </button>
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(prev => Math.max(1, prev - 1))}
                            className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all shadow-sm"
                        >
                            <ChevronLeft size={16} />
                        </button>
                    </div>

                    <div className="bg-white px-6 h-10 rounded-xl border border-slate-100 flex items-center justify-center gap-4 shadow-sm">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Page</span>
                        <span className="text-xs font-black text-emerald-600">{page}</span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Of</span>
                        <span className="text-xs font-black text-slate-900">{totalPages}</span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                            className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all shadow-sm"
                        >
                            <ChevronRight size={16} />
                        </button>
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(totalPages)}
                            className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all shadow-sm"
                        >
                            <ChevronsRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
