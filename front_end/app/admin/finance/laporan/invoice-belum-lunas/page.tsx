'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import type { ArRow } from '@/app/admin/finance/piutang/arShared';
import { toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';

type SupplierInvoiceRow = {
  id: number;
  invoice_number: string;
  status: string;
  due_date: string;
  total: number | string;
  amount_due?: number;
  Supplier?: { id: number; name?: string | null } | null;
};

type CombinedRow = {
  kind: 'AR' | 'AP';
  key: string;
  party: string;
  doc: string;
  dueDate?: string | null;
  amountDue: number;
  href: string;
};

export default function LaporanInvoiceBelumLunasPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [loading, setLoading] = useState(false);
  const [arRows, setArRows] = useState<ArRow[]>([]);
  const [apRows, setApRows] = useState<SupplierInvoiceRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [arRes, apRes] = await Promise.all([
        api.admin.finance.getAR(),
        api.admin.finance.getSupplierInvoices({ page: 1, limit: 200, status: 'unpaid' }),
      ]);
      setArRows(Array.isArray(arRes.data) ? (arRes.data as ArRow[]) : []);
      setApRows(Array.isArray(apRes.data?.invoices) ? (apRes.data.invoices as SupplierInvoiceRow[]) : []);
    } catch (e) {
      console.error(e);
      alert('Gagal memuat gabungan invoice belum lunas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const combined = useMemo<CombinedRow[]>(() => {
    const ar = arRows.map<CombinedRow>((row) => ({
      kind: 'AR',
      key: `ar-${row.id}`,
      party: toText(row.order?.customer_name, 'Customer'),
      doc: toText(row.invoice_number),
      dueDate: row.order?.expiry_date || null,
      amountDue: toNumber(row.amount_due),
      href: `/admin/finance/piutang/${row.id}`,
    }));
    const ap = apRows.map<CombinedRow>((row) => ({
      kind: 'AP',
      key: `ap-${row.id}`,
      party: toText(row.Supplier?.name, 'Supplier'),
      doc: toText(row.invoice_number),
      dueDate: row.due_date || null,
      amountDue: toNumber(row.amount_due),
      href: `/admin/finance/laporan/bayar-supplier?invoice=${row.id}`,
    }));
    return [...ar, ...ap].filter((r) => r.amountDue > 0).sort((a, b) => b.amountDue - a.amountDue);
  }, [apRows, arRows]);

  const totals = useMemo(() => {
    const ar = combined.filter((r) => r.kind === 'AR').reduce((sum, r) => sum + r.amountDue, 0);
    const ap = combined.filter((r) => r.kind === 'AP').reduce((sum, r) => sum + r.amountDue, 0);
    return { ar, ap, total: ar + ap };
  }, [combined]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Gabungan Invoice Belum Lunas</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={loading}
            onClick={load}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-50"
          >
            Refresh
          </button>
          <Link href="/admin/invoices" className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50">
            Buka AR
          </Link>
          <Link href="/admin/finance/laporan/invoice-supplier" className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50">
            Buka AP
          </Link>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Outstanding</p>
            <p className="text-2xl font-black text-rose-700">{formatCurrency(totals.total)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">AR (Customer)</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(totals.ar)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">AP (Supplier)</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(totals.ap)}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">Daftar Outstanding</h2>
            <span className="text-xs text-slate-500">
              Item: <span className="font-bold text-slate-700">{combined.length}</span>
              {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
            </span>
          </div>

          {!loading && combined.length === 0 && <p className="text-sm text-slate-400">Tidak ada data outstanding.</p>}

          {combined.length > 0 && (
            <div className="space-y-2">
              {combined.slice(0, 200).map((row) => (
                <Link
                  key={row.key}
                  href={row.href}
                  className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">
                        {row.party}{' '}
                        <span className={`ml-2 text-[10px] font-black uppercase tracking-widest ${row.kind === 'AR' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {row.kind}
                        </span>
                      </p>
                      <p className="text-xs text-slate-600 truncate">
                        {row.doc} {row.dueDate ? `• Due ${row.dueDate}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Sisa</p>
                      <p className="text-sm font-black text-rose-700">{formatCurrency(row.amountDue)}</p>
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
