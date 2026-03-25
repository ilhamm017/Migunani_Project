'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, ChevronLeft, ChevronRight, Clock, Package, Search, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface PreorderRow {
  id: string;
  supplier_id: number;
  status: 'draft' | 'finalized' | 'canceled';
  createdAt: string;
  Supplier?: { id: number; name: string };
}

export default function PreorderHistoryPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const [rows, setRows] = useState<PreorderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.procurement.getPreorders({ page, limit: 10, status: statusFilter || undefined });
      setRows((res.data?.preorders || []) as PreorderRow[]);
      setTotalPages(Number(res.data?.totalPages || 1));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    if (!allowed) return;
    void loadRows();
  }, [allowed, loadRows]);

  if (!allowed) return null;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'finalized': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'draft': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'canceled': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'finalized': return 'Finalized';
      case 'draft': return 'Draft';
      case 'canceled': return 'Canceled';
      default: return status;
    }
  };

  return (
    <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
      <div className="flex items-center justify-between gap-4 mb-2 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/warehouse/po"
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
          >
            <ArrowLeft size={20} className="text-slate-600" />
          </Link>
          <div>
            <h1 className="warehouse-title !mb-0 flex items-center gap-2">
              <Clock className="text-emerald-600" />
              Riwayat PO (PreOrder Supplier)
            </h1>
            <p className="warehouse-subtitle !mb-0">History pembuatan preorder ke supplier.</p>
          </div>
        </div>
      </div>

      <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm mb-4 shrink-0">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              placeholder="Filter search belum tersedia (gunakan filter status)."
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
              disabled
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
            >
              <option value="">Semua Status</option>
              <option value="draft">Draft</option>
              <option value="finalized">Finalized</option>
              <option value="canceled">Canceled</option>
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
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 text-slate-400 border-2 border-dashed border-slate-100 rounded-[32px] bg-white">
              <Package size={64} className="opacity-10 mb-4" />
              <p className="font-bold">Tidak ada data PO.</p>
            </div>
          ) : (
            rows.map((row) => (
              <Link
                key={row.id}
                href={`/admin/warehouse/po/${row.id}`}
                className="block warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 hover:border-emerald-500 hover:shadow-xl transition-all group relative overflow-hidden"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">
                        #{row.id.split('-')[0].toUpperCase()}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider border ${getStatusStyle(row.status)}`}>
                        {getStatusLabel(row.status)}
                      </span>
                    </div>
                    <h3 className="text-lg font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                      {row.Supplier?.name || 'Unknown Supplier'}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 text-xs font-medium">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={14} className="text-slate-400" />
                        {new Date(row.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-black text-slate-500 uppercase tracking-widest">
                    Buka Detail →
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
              onClick={() => setPage((p) => p - 1)}
              className="p-2 border border-slate-200 bg-white rounded-xl disabled:opacity-30 hover:bg-slate-50 text-slate-600 transition-all shadow-sm"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-black text-slate-700 px-4">
              Halaman {page} dari {totalPages}
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
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

