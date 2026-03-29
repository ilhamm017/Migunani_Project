'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Camera, MapPin, Package, RefreshCw, Loader2, Users, Boxes } from 'lucide-react';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type PicklistTotals = {
    total_allocated_qty: number;
    order_count: number;
    customer_count: number;
    product_count: number;
};

type ProductPicklistRow = {
    product_id: string;
    sku: string;
    name: string;
    image_url: string | null;
    bin_location: string | null;
    total_allocated_qty: number;
    order_count: number;
    customer_count: number;
    batch_layers?: Array<{ unit_cost: number; qty_reserved: number }>;
};

type CustomerPicklistItem = {
    allocation_id: string;
    allocation_status: 'pending' | 'picked' | 'shipped';
    product_id: string;
    sku: string;
    name: string;
    image_url: string | null;
    bin_location: string | null;
    allocated_qty: number;
    reserved_layers?: Array<{ unit_cost: number; qty_reserved: number }>;
};

type CustomerPicklistRow = {
    order_id: string;
    order_status: string | null;
    created_at: string | null;
    customer_id: string | null;
    customer_name: string;
    item_count: number;
    total_allocated_qty: number;
    items: CustomerPicklistItem[];
};

type PicklistResponse =
    | { view: 'product'; totals: PicklistTotals; rows: ProductPicklistRow[] }
    | { view: 'customer'; totals: PicklistTotals; rows: CustomerPicklistRow[] };

const DEFAULT_TOTALS: PicklistTotals = {
    total_allocated_qty: 0,
    order_count: 0,
    customer_count: 0,
    product_count: 0,
};

export default function WarehouseHelperPage() {
    const [view, setView] = useState<'product' | 'customer'>('product');
    const [allocationStatus, setAllocationStatus] = useState<'pending' | 'picked' | 'shipped' | 'all'>('pending');
    const [q, setQ] = useState('');
    const [data, setData] = useState<PicklistResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadPicklist = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = Boolean(opts?.silent);
        try {
            if (!silent) setLoading(true);
            setError(null);
            const res = await api.allocation.getPicklist({
                view,
                q: q.trim() || undefined,
                allocation_status: allocationStatus,
                order_status: 'allocated,partially_fulfilled',
                limit: 20000,
            });
            const payload = (res.data || null) as PicklistResponse | null;
            if (!payload || (payload.view !== 'product' && payload.view !== 'customer')) {
                setData(null);
                setError('Respon picklist tidak valid.');
                return;
            }
            setData(payload);
        } catch {
            if (!silent) setError('Gagal memuat picklist alokasi.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [allocationStatus, q, view]);

    useEffect(() => {
        void loadPicklist();
    }, [loadPicklist]);

    useRealtimeRefresh({
        enabled: true,
        onRefresh: () => loadPicklist({ silent: true }),
        domains: ['order', 'admin'],
        pollIntervalMs: 15000,
    });

    const totals = data?.totals || DEFAULT_TOTALS;
    const productRows = useMemo(() => (data && data.view === 'product' ? data.rows : []), [data]);
    const customerRows = useMemo(() => (data && data.view === 'customer' ? data.rows : []), [data]);

    return (
        <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden bg-slate-50">
            <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-1 border-b border-slate-200">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gudang</p>
                        <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">Picklist Alokasi</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            List seluruh barang order yang sudah dialokasikan untuk proses picking/prepare.
                        </p>
                    </div>

                    <button
                        onClick={() => void loadPicklist()}
                        disabled={loading}
                        className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Refresh
                    </button>
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2">
                        <button
                            onClick={() => setView('product')}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-black ${view === 'product' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
                        >
                            <Boxes size={14} />
                            Per Barang
                        </button>
                        <button
                            onClick={() => setView('customer')}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-black ${view === 'customer' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
                        >
                            <Users size={14} />
                            Per Pemesan
                        </button>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Status Alokasi</label>
                        <select
                            value={allocationStatus}
                            onChange={(e) => setAllocationStatus(e.target.value as typeof allocationStatus)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none"
                        >
                            <option value="pending">Pending (Belum diambil)</option>
                            <option value="picked">Picked (Sudah diambil)</option>
                            <option value="shipped">Shipped</option>
                            <option value="all">Semua</option>
                        </select>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Cari</label>
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="SKU / nama barang / bin / nama pemesan / order id"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none"
                        />
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Qty</p>
                        <p className="text-lg font-black text-slate-900">{Number(totals.total_allocated_qty || 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Order</p>
                        <p className="text-lg font-black text-slate-900">{Number(totals.order_count || 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Pemesan</p>
                        <p className="text-lg font-black text-slate-900">{Number(totals.customer_count || 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Produk</p>
                        <p className="text-lg font-black text-slate-900">{Number(totals.product_count || 0)}</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                        <Loader2 size={24} className="animate-spin" />
                        <span className="ml-2 text-sm font-bold">Memuat picklist...</span>
                    </div>
                ) : error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 font-bold">{error}</div>
                ) : view === 'product' ? (
                    productRows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <Package size={48} className="mb-3 opacity-40" />
                            <p className="text-base font-bold text-slate-500">Tidak ada data</p>
                            <p className="text-sm text-slate-400 mt-1">Belum ada alokasi untuk filter ini.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500">
                                            <th className="px-4 py-3">Bin</th>
                                            <th className="px-4 py-3">SKU</th>
                                            <th className="px-4 py-3">Produk</th>
                                            <th className="px-4 py-3">Batch (HPP)</th>
                                            <th className="px-4 py-3 text-right">Qty</th>
                                            <th className="px-4 py-3 text-right">Order</th>
                                            <th className="px-4 py-3 text-right">Pemesan</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {productRows.map((row) => (
                                            <tr key={row.product_id} className="hover:bg-slate-50">
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center gap-2">
                                                        <MapPin size={14} className="text-emerald-600" />
                                                        <span className="font-mono font-black text-emerald-700">{row.bin_location || '—'}</span>
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                                        {row.sku || '—'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3 min-w-[260px]">
                                                        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                                                            {row.image_url ? (
                                                                <Image src={row.image_url} alt={row.name} width={40} height={40} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <Camera size={16} className="text-slate-300" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-black text-slate-800 truncate">{row.name}</p>
                                                            <p className="text-[11px] text-slate-400 font-bold truncate">ID: {row.product_id.slice(0, 8)}…</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {Array.isArray(row.batch_layers) && row.batch_layers.length > 0 ? (
                                                        <p className="text-[11px] font-bold text-slate-700 whitespace-normal break-words">
                                                            {row.batch_layers
                                                                .filter((l) => Number(l?.qty_reserved || 0) > 0)
                                                                .map((l) => `${formatCurrency(Number(l.unit_cost || 0))} × ${Number(l.qty_reserved || 0)}`)
                                                                .join(' • ')}
                                                        </p>
                                                    ) : (
                                                        <p className="text-[11px] text-slate-500">FIFO (auto)</p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-slate-900">{Number(row.total_allocated_qty || 0)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{Number(row.order_count || 0)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{Number(row.customer_count || 0)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                ) : customerRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                        <Package size={48} className="mb-3 opacity-40" />
                        <p className="text-base font-bold text-slate-500">Tidak ada data</p>
                        <p className="text-sm text-slate-400 mt-1">Belum ada alokasi untuk filter ini.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customerRows.map((order) => (
                            <div key={order.order_id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-4 flex items-start justify-between gap-3 border-b border-slate-100">
                                    <div className="min-w-0">
                                        <p className="text-xs font-black text-slate-900 truncate">{order.customer_name}</p>
                                        <p className="text-[11px] text-slate-500 font-bold mt-0.5">
                                            Order <span className="font-mono">{order.order_id.slice(0, 8)}…</span> • Status:{' '}
                                            <span className="font-black">{order.order_status || '—'}</span>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Qty</p>
                                        <p className="text-lg font-black text-slate-900">{Number(order.total_allocated_qty || 0)}</p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-slate-50 border-b border-slate-200">
                                            <tr className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500">
                                                <th className="px-4 py-3">Bin</th>
                                                <th className="px-4 py-3">SKU</th>
                                                <th className="px-4 py-3">Produk</th>
                                                <th className="px-4 py-3 text-right">Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {order.items.map((item) => (
                                                <tr key={item.allocation_id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3">
                                                        <span className="inline-flex items-center gap-2">
                                                            <MapPin size={14} className="text-emerald-600" />
                                                            <span className="font-mono font-black text-emerald-700">{item.bin_location || '—'}</span>
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                                            {item.sku || '—'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3 min-w-[260px]">
                                                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                                                                {item.image_url ? (
                                                                    <Image src={item.image_url} alt={item.name} width={40} height={40} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <Camera size={16} className="text-slate-300" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-black text-slate-800 truncate">{item.name}</p>
                                                                <p className="text-[11px] text-slate-400 font-bold truncate">Status alokasi: {item.allocation_status}</p>
                                                                {Array.isArray(item.reserved_layers) && item.reserved_layers.length > 0 ? (
                                                                    <p className="mt-1 text-[11px] text-slate-600 font-bold whitespace-normal break-words">
                                                                        Batch (HPP):{' '}
                                                                        {item.reserved_layers
                                                                            .map((layer) => `${formatCurrency(Number(layer.unit_cost || 0))} × ${Number(layer.qty_reserved || 0)}`)
                                                                            .join(' • ')}
                                                                    </p>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-slate-900">{Number(item.allocated_qty || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
