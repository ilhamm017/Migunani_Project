'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import type { ArRow } from '@/app/admin/finance/piutang/arShared';
import { toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type SupplierInvoiceRow = {
  id: number;
  invoice_number: string;
  status: string;
  due_date: string;
  total: number | string;
  amount_due?: number;
  Supplier?: { id: number; name?: string | null } | null;
};

type DueRow =
  | { kind: 'supplier'; id: string; dueDate: string; title: string; amountDue: number; href: string; subtitle?: string }
  | { kind: 'customer'; id: string; dueDate: string; title: string; amountDue: number; href: string; subtitle?: string };

const toIsoDate = (d: Date) => d.toISOString().split('T')[0];

export default function LaporanJatuhTempoPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoiceRow[]>([]);
  const [arRows, setArRows] = useState<ArRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [apRes, arRes] = await Promise.all([
        api.admin.finance.getSupplierInvoices({ page: 1, limit: 200, status: 'unpaid' }),
        api.admin.finance.getAR(),
      ]);
      setSupplierInvoices(Array.isArray(apRes.data?.invoices) ? (apRes.data.invoices as SupplierInvoiceRow[]) : []);
      setArRows(Array.isArray(arRes.data) ? (arRes.data as ArRow[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan jatuh tempo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const dueRows = useMemo<DueRow[]>(() => {
    const now = new Date();
    const threshold = new Date(now.getTime() + Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000);
    const thresholdIso = toIsoDate(threshold);

    const ap = supplierInvoices
      .filter((inv) => String(inv.due_date || '') && String(inv.due_date) <= thresholdIso)
      .map<DueRow>((inv) => ({
        kind: 'supplier',
        id: `ap-${inv.id}`,
        dueDate: inv.due_date,
        title: toText(inv.Supplier?.name, 'Supplier'),
        subtitle: `Inv ${toText(inv.invoice_number)}`,
        amountDue: toNumber(inv.amount_due),
        href: `/admin/finance/laporan/bayar-supplier?invoice=${inv.id}`,
      }));

    const ar = arRows
      .filter((row) => row.order?.expiry_date && String(row.order.expiry_date) <= thresholdIso)
      .map<DueRow>((row) => ({
        kind: 'customer',
        id: `ar-${row.id}`,
        dueDate: String(row.order.expiry_date),
        title: toText(row.order?.customer_name, 'Customer'),
        subtitle: `Inv ${toText(row.invoice_number)} • Order ${toText(row.order?.id).slice(-8).toUpperCase()}`,
        amountDue: toNumber(row.amount_due),
        href: `/admin/finance/piutang/${row.id}`,
      }));

    return [...ap, ...ar].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  }, [arRows, days, supplierInvoices]);

  const totalDue = useMemo(() => dueRows.reduce((sum, row) => sum + toNumber(row.amountDue), 0), [dueRows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Jatuh Tempo</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-slate-100 p-2 rounded-xl">
          <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-white rounded-lg px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Range</span>
            <input
              type="number"
              min={0}
              value={Number.isFinite(days) ? days : 7}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700"
            />
            <span className="text-xs font-bold text-slate-700">hari ke depan</span>
          </div>
          <button onClick={load} className="bg-slate-900 text-white px-4 rounded-lg text-xs font-bold py-2">
            Refresh
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Jatuh Tempo</p>
          <p className="text-3xl font-black text-rose-700">{formatCurrency(totalDue)}</p>
          <p className="text-xs text-slate-500 mt-2">
            Item: <span className="font-bold text-slate-700">{dueRows.length}</span>
            {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Daftar Jatuh Tempo</h2>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <Link href="/admin/finance/laporan/invoice-supplier" className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">
                AP
              </Link>
              <Link href="/admin/invoices" className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">
                AR
              </Link>
            </div>
          </div>

          {!loading && dueRows.length === 0 && <p className="text-sm text-slate-400">Tidak ada jatuh tempo pada range ini.</p>}

          {dueRows.length > 0 && (
            <div className="space-y-2">
              {dueRows.map((row) => (
                <Link
                  key={row.id}
                  href={row.href}
                  className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">
                        {row.title}{' '}
                        <span className={`ml-2 text-[10px] font-black uppercase tracking-widest ${row.kind === 'supplier' ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {row.kind === 'supplier' ? 'AP' : 'AR'}
                        </span>
                      </p>
                      <p className="text-xs text-slate-600 truncate">
                        Due {toText(row.dueDate)} {row.subtitle ? `• ${row.subtitle}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Sisa</p>
                      <p className="text-sm font-black text-rose-700">{formatCurrency(toNumber(row.amountDue))}</p>
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
