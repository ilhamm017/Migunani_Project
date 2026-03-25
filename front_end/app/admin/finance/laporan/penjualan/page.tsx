'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type OrderRow = {
  id?: string;
  status?: string | null;
  createdAt?: string | null;
  customer_name?: string | null;
  total_amount?: number | null;
  invoice_number?: string | null;
};

const EXCLUDED_STATUSES = new Set(['canceled', 'expired']);

export default function LaporanPenjualanPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance', 'kasir']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<OrderRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        page: 1,
        limit: 200,
        status: 'all',
        startDate,
        endDate,
      });
      setRows(Array.isArray(res.data?.orders) ? (res.data.orders as OrderRow[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan penjualan');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const normalizedRows = useMemo(() => rows.filter((row) => row && row.id), [rows]);

  const { totalOmzet, totalOrder } = useMemo(() => {
    const validRows = normalizedRows.filter((row) => !EXCLUDED_STATUSES.has(String(row.status || '').trim()));
    return {
      totalOmzet: validRows.reduce((sum, row) => sum + toNumber(row.total_amount), 0),
      totalOrder: validRows.length,
    };
  }, [normalizedRows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Laporan Penjualan</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_80px] gap-2 bg-slate-100 p-2 rounded-xl">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
          />
          <button onClick={load} className="bg-slate-900 text-white rounded-lg text-xs font-bold">
            Go
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Catatan: list dibatasi 200 order terbaru pada periode.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Omzet</p>
            <p className="text-3xl font-black text-slate-900">{formatCurrency(totalOmzet)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Order</p>
            <p className="text-3xl font-black text-slate-900">{totalOrder}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Daftar Order</h2>
            <Link
              href="/admin/orders"
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
            >
              Buka Monitor Order
            </Link>
          </div>

          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && normalizedRows.length === 0 && <p className="text-sm text-slate-400">Tidak ada order pada periode ini.</p>}

          {!loading && normalizedRows.length > 0 && (
            <div className="space-y-2">
              {normalizedRows.map((row) => (
                <Link
                  key={String(row.id)}
                  href={`/admin/orders/${row.id}`}
                  className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{toText(row.customer_name, 'Customer')}</p>
                      <p className="text-xs text-slate-600 truncate">
                        Order {toText(row.id).slice(-8).toUpperCase()} • {row.invoice_number ? `Inv ${row.invoice_number} • ` : ''}
                        Status {toText(row.status)}
                      </p>
                      {row.createdAt ? (
                        <p className="text-[10px] text-slate-500">{formatDateTime(row.createdAt)}</p>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Total</p>
                      <p className="text-sm font-black text-slate-900">{formatCurrency(toNumber(row.total_amount))}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
