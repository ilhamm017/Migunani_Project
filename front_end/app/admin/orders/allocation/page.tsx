'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Box, User, Calendar, ArrowRight } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';

const ALLOCATION_EDITABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;

export default function AllocationListPage() {
    const allowed = useRequireRoles(['super_admin', 'kasir']);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [onlyShortage, setOnlyShortage] = useState(true);

    useEffect(() => {
        if (allowed) loadData();
    }, [onlyShortage, allowed]);

    const loadData = async () => {
        if (!allowed) return;
        setLoading(true);
        try {
            const res = await api.allocation.getPending({
                scope: onlyShortage ? 'shortage' : 'all'
            });
            const payload = res.data;
            const rows = Array.isArray(payload) ? payload : payload?.rows || [];
            setOrders(rows);
        } catch (error) {
            console.error('Failed to load pending allocations', error);
        } finally {
            setLoading(false);
        }
    };

    const stats = useMemo(() => {
        const total = orders.length;
        let shortage = 0;
        let preorder = 0;
        let backorder = 0;
        let fulfilled = 0;
        orders.forEach((order: any) => {
            const hasShortage = Number(order.shortage_total || 0) > 0;
            if (hasShortage) {
                shortage += 1;
                if (order.is_backorder) {
                    backorder += 1;
                } else {
                    preorder += 1;
                }
                return;
            }
            fulfilled += 1;
        });
        return { total, shortage, preorder, backorder, fulfilled };
    }, [orders]);

    if (!allowed) return null;

    return (
        <div className="warehouse-page">
            <div>
                <h1 className="warehouse-title">Alokasi Stok Order</h1>
                <p className="warehouse-subtitle">Alokasikan stok untuk pesanan yang masuk sebelum diproses ke tim picker atau pengiriman.</p>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700">Total {stats.total}</span>
                        <span className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700">Kurang Stok {stats.shortage}</span>
                        <span className="px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">Pre-order {stats.preorder}</span>
                        <span className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700">Backorder {stats.backorder}</span>
                        {!onlyShortage && (
                            <span className="px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">Fulfilled {stats.fulfilled}</span>
                        )}
                    </div>

                    <button
                        onClick={() => setOnlyShortage(prev => !prev)}
                        className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-colors ${onlyShortage
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                    >
                        {onlyShortage ? 'Hanya yang kurang stok: ON' : 'Hanya yang kurang stok: OFF'}
                    </button>
                </div>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4 font-bold text-slate-700">Order ID</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Tanggal</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Customer</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Status</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Item</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Loading...</td></tr>
                        ) : orders.length === 0 ? (
                            <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Tidak ada order untuk tampilan ini.</td></tr>
                        ) : (
                            orders.map((order: any) => {
                                const hasShortage = Number(order.shortage_total || 0) > 0;
                                const isEditable = ALLOCATION_EDITABLE_STATUSES.includes(String(order.status || '') as typeof ALLOCATION_EDITABLE_STATUSES[number]);
                                const canProcess = hasShortage && isEditable;

                                return (
                                    <tr key={order.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4 font-mono text-xs text-slate-500">
                                            {order.id.substring(0, 8)}...
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 text-slate-700">
                                                <Calendar size={14} className="text-slate-400" />
                                                {new Date(order.createdAt).toLocaleDateString('id-ID')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-bold text-slate-900">
                                                <User size={14} className="text-slate-400" />
                                                {order.Customer?.name || 'Guest'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`inline-flex px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest
                                                    ${order.status === 'waiting_invoice' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                                                        order.status === 'waiting_payment' ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' :
                                                            order.status === 'ready_to_ship' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                                                order.status === 'hold' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                                                                    'bg-slate-50 text-slate-700 border border-slate-100'}
                                                `}>
                                                    {order.status}
                                                </span>
                                                <span className={`inline-flex px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${Number(order.shortage_total || 0) <= 0
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                    : order.is_backorder
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                                        : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                                    }`}>
                                                    {Number(order.shortage_total || 0) <= 0 ? 'Fulfilled' : (order.is_backorder ? 'Backorder' : 'Pre-order')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 text-slate-600">
                                                <Box size={14} />
                                                {order.OrderItems?.length || 0} Item
                                            </div>
                                            {Number(order.shortage_total || 0) > 0 ? (
                                                <div className="mt-1 text-[11px] font-bold text-rose-600">
                                                    Kurang: {Number(order.shortage_total || 0)}
                                                </div>
                                            ) : (
                                                <div className="mt-1 text-[11px] font-bold text-emerald-600">
                                                    Alokasi sudah penuh
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link
                                                href={`/admin/orders/allocation/${order.id}`}
                                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${canProcess
                                                    ? 'text-white bg-blue-600 hover:bg-blue-700'
                                                    : 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                                                    }`}
                                            >
                                                {canProcess ? 'Proses' : 'Lihat'}
                                                <ArrowRight size={14} />
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
