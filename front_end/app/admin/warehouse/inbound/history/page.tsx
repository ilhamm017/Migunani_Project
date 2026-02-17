'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    ChevronLeft,
    Search,
    Calendar,
    User,
    Truck,
    Clock,
    ChevronRight,
    Package,
    ArrowLeft
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface PO {
    id: string;
    supplier_id: number;
    status: 'pending' | 'received' | 'partially_received' | 'canceled';
    total_cost: number;
    createdAt: string;
    Supplier?: {
        id: number;
        name: string;
    };
}

export default function POHistoryPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'kasir'], '/admin');
    const [pos, setPos] = useState<PO[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        if (allowed) {
            loadPOs();
        }
    }, [allowed, page, statusFilter]);

    const loadPOs = async () => {
        try {
            setLoading(true);
            const res = await api.admin.inventory.getPOs({
                page,
                limit: 10,
                status: statusFilter || undefined
            });
            setPos(res.data.purchaseOrders);
            setTotalPages(res.data.totalPages);
        } catch (error) {
            console.error('Failed to load POs', error);
        } finally {
            setLoading(false);
        }
    };

    if (!allowed) return null;

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'received': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'partially_received': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'pending': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'canceled': return 'bg-rose-100 text-rose-700 border-rose-200';
            default: return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'received': return 'Diterima';
            case 'partially_received': return 'Parsial';
            case 'pending': return 'Pending';
            case 'canceled': return 'Dibatalkan';
            default: return status;
        }
    };

    return (
        <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
            <div className="flex items-center justify-between gap-4 mb-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Link
                        href="/admin/warehouse/inbound"
                        className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
                    >
                        <ArrowLeft size={20} className="text-slate-600" />
                    </Link>
                    <div>
                        <h1 className="warehouse-title !mb-0 flex items-center gap-2">
                            <Clock className="text-emerald-600" />
                            Riwayat Purchase Order (PO)
                        </h1>
                        <p className="warehouse-subtitle !mb-0">Daftar semua PO dan status penerimaan barang.</p>
                    </div>
                </div>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm mb-4 shrink-0">
                <div className="flex flex-col md:flex-row gap-4 items-center">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            placeholder="Cari PO ID atau Supplier..."
                            className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                        />
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                        >
                            <option value="">Semua Status</option>
                            <option value="pending">Pending</option>
                            <option value="partially_received">Parsial</option>
                            <option value="received">Diterima</option>
                            <option value="canceled">Dibatalkan</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center p-20 text-slate-400">
                            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : pos.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-20 text-slate-400 border-2 border-dashed border-slate-100 rounded-[32px] bg-white">
                            <Package size={64} className="opacity-10 mb-4" />
                            <p className="font-bold">Tidak ada data PO.</p>
                        </div>
                    ) : (
                        pos.map((po) => (
                            <Link
                                key={po.id}
                                href={`/admin/warehouse/inbound/${po.id}`}
                                className="block warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 hover:border-emerald-500 hover:shadow-xl transition-all group relative overflow-hidden"
                            >
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">#{po.id.split('-')[0].toUpperCase()}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider border ${getStatusStyle(po.status)}`}>
                                                {getStatusLabel(po.status)}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                                            {po.Supplier?.name || 'Unknown Supplier'}
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 text-xs font-medium">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar size={14} className="text-slate-400" />
                                                {new Date(po.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Package size={14} className="text-slate-400" />
                                                Rp {Number(po.total_cost).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="hidden md:flex flex-col items-end text-right">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Total PO</span>
                                            <span className="text-xl font-black text-slate-900 mt-1">Rp {Number(po.total_cost).toLocaleString()}</span>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded-2xl group-hover:bg-emerald-100 transition-colors">
                                            <ChevronRight className="text-slate-400 group-hover:text-emerald-700" size={24} />
                                        </div>
                                    </div>
                                </div>
                                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/20 rounded-full blur-3xl -mr-10 -mt-10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                        ))
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 py-4 shrink-0">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="p-2 border border-slate-200 bg-white rounded-xl disabled:opacity-30 hover:bg-slate-50 text-slate-600 transition-all shadow-sm"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <span className="text-sm font-black text-slate-700 px-4">
                            Halaman {page} dari {totalPages}
                        </span>
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="p-2 border border-slate-200 bg-white rounded-xl disabled:opacity-30 hover:bg-slate-50 text-slate-600 transition-all shadow-sm"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
