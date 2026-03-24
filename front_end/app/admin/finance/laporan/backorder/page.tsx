'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft, Download, Filter, Package, Users } from 'lucide-react';
import Link from 'next/link';

interface BackorderSummary {
    total_items: number;
    total_value: number;
    backorder_count: number;
    preorder_count: number;
}

interface BackorderTopProduct {
    name: string;
    sku: string;
    qty: number;
    value: number;
}

interface BackorderTopCustomer {
    name: string;
    value: number;
    qty: number;
}

interface BackorderDetailItem {
    id: string;
    product_name: string;
    customer_name: string;
    type: 'preorder' | 'backorder' | string;
    qty: number;
    total_value: number;
    order_id?: string;
    date?: string;
}

interface BackorderReportData {
    summary: BackorderSummary;
    top_products?: BackorderTopProduct[];
    top_customers?: BackorderTopCustomer[];
    details?: BackorderDetailItem[];
}

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

export default function BackorderReportPage() {
    const allowed = useRequireRoles(['super_admin', 'kasir']);
    const [data, setData] = useState<BackorderReportData | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return toDateInputValue(d);
    });
    const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));

    const filterParams = useMemo(() => ({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
    }), [startDate, endDate]);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getBackorderReport(filterParams);
            setData(res.data);
        } catch (e) {
            console.error(e);
            alert('Gagal memuat laporan');
        } finally {
            setLoading(false);
        }
    }, [filterParams]);

    const handleExport = useCallback(async () => {
        try {
            setExporting(true);
            const res = await api.admin.finance.exportBackorderReport(filterParams);
            const contentDisposition = String(res.headers?.['content-disposition'] || '');
            const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
            const fileName = fileNameMatch?.[1] || `laporan-backorder-preorder-${toDateInputValue(new Date()).replace(/-/g, '')}.xlsx`;

            const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            alert('Gagal export Excel');
        } finally {
            setExporting(false);
        }
    }, [filterParams]);

    useEffect(() => {
        if (allowed) load();
    }, [allowed, load]);

    if (!allowed) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-10">
            <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40 mb-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                            <ArrowLeft size={20} className="text-slate-700" />
                        </Link>
                        <h1 className="font-bold text-lg text-slate-900">Laporan Backorder / Preorder</h1>
                    </div>
                    <button
                        type="button"
                        onClick={handleExport}
                        disabled={exporting || loading}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white disabled:opacity-60"
                    >
                        <Download size={14} />
                        {exporting ? 'Exporting...' : 'Export Excel'}
                    </button>
                </div>
            </div>

            <div className="px-5 space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 mb-3">
                        <Filter size={14} />
                        Filter Tanggal
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Dari</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Sampai</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-10 text-slate-400">Loading...</div>
                ) : data ? (
                    <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Total Item</p>
                                <p className="text-xl font-black text-slate-900">{data.summary.total_items}</p>
                            </div>
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Estimasi Nilai</p>
                                <p className="text-xl font-black text-orange-600">{formatCurrency(data.summary.total_value)}</p>
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                            <div className="flex justify-around text-center">
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Backorder</p>
                                    <p className="text-2xl font-black text-blue-600">{data.summary.backorder_count}</p>
                                </div>
                                <div className="w-px bg-slate-100"></div>
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Preorder</p>
                                    <p className="text-2xl font-black text-purple-600">{data.summary.preorder_count}</p>
                                </div>
                            </div>
                        </div>

                        {/* Top Products */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-white">
                            <div className="flex items-center gap-2 mb-4">
                                <Package size={18} className="text-slate-400" />
                                <h3 className="font-bold text-slate-900">Produk Paling Kurang</h3>
                            </div>
                            <div className="space-y-3">
                                {data.top_products?.map((p, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between">
                                        <div className="min-w-0 flex-1 mr-4">
                                            <p className="text-sm font-bold text-slate-900 truncate">{p.name}</p>
                                            <p className="text-[10px] text-slate-400 font-mono">{p.sku}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-black text-rose-600">x{p.qty}</p>
                                            <p className="text-[10px] text-slate-400">{formatCurrency(p.value)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Top Customers */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-white">
                            <div className="flex items-center gap-2 mb-4">
                                <Users size={18} className="text-slate-400" />
                                <h3 className="font-bold text-slate-900">Pelanggan Menunggu</h3>
                            </div>
                            <div className="space-y-3">
                                {data.top_customers?.map((c, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-slate-700">{c.name}</p>
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-slate-900">{formatCurrency(c.value)}</p>
                                            <p className="text-[10px] text-slate-400">{c.qty} Item</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Detailed List */}
                        <div>
                            <div className="flex items-center justify-between mb-3 px-1">
                                <h3 className="font-bold text-slate-900">Daftar Rincian</h3>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">{data.details?.length} Order</p>
                            </div>
                            <div className="space-y-3">
                                {data.details?.map((item) => (
                                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-bold text-slate-900 text-sm">{item.product_name}</h4>
                                                <p className="text-[10px] text-slate-400 mb-1">{item.customer_name}</p>
                                                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${item.type === 'preorder' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {item.type}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-black text-slate-900 text-sm">x{item.qty}</p>
                                                <p className="text-[10px] text-slate-500 font-bold">{formatCurrency(item.total_value)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-2 pt-2 border-t border-slate-50 flex justify-between items-center text-[10px]">
                                            <span className="text-slate-400 font-mono">Order: {item.order_id?.slice(-8) || '-'}</span>
                                            <span className="text-slate-400">
                                                {item.date ? new Date(item.date).toLocaleDateString() : '-'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
