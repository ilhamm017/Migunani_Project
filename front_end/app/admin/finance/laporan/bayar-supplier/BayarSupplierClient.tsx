'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';

type SupplierInvoiceRow = {
  id: number;
  invoice_number: string;
  status: 'unpaid' | 'paid' | 'overdue' | string;
  total: number | string;
  due_date: string;
  Supplier?: { id: number; name?: string | null } | null;
  paid_total?: number;
  amount_due?: number;
};

type AccountNode = {
  id: number;
  code: string;
  name: string;
  type?: string;
  is_active?: boolean;
  Children?: AccountNode[];
};

const flattenAccounts = (nodes: AccountNode[]) => {
  const out: AccountNode[] = [];
  const walk = (list: AccountNode[]) => {
    list.forEach((node) => {
      out.push(node);
      if (Array.isArray(node.Children) && node.Children.length) walk(node.Children);
    });
  };
  walk(nodes);
  return out;
};

export default function BayarSupplierClient() {
  const allowed = useRequireRoles(['super_admin']);
  const searchParams = useSearchParams();
  const invoiceFromUrl = Number(searchParams.get('invoice') || 0);

  const [loading, setLoading] = useState(false);
  const [busyPay, setBusyPay] = useState(false);
  const [invoices, setInvoices] = useState<SupplierInvoiceRow[]>([]);
  const [accounts, setAccounts] = useState<AccountNode[]>([]);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number>(invoiceFromUrl || 0);
  const [accountId, setAccountId] = useState<number>(0);
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [invRes, acctRes] = await Promise.all([
        api.admin.finance.getSupplierInvoices({ page: 1, limit: 200, status: 'unpaid' }),
        api.admin.accounts.getAll(),
      ]);
      setInvoices(Array.isArray(invRes.data?.invoices) ? (invRes.data.invoices as SupplierInvoiceRow[]) : []);
      setAccounts(Array.isArray(acctRes.data) ? (acctRes.data as AccountNode[]) : []);
    } catch (e) {
      console.error(e);
      alert('Gagal memuat data bayar supplier');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const selectableAccounts = useMemo(() => {
    const flat = flattenAccounts(accounts);
    return flat
      .filter((acc) => acc && acc.is_active !== false)
      .filter((acc) => String(acc.type || '').toLowerCase() === 'asset')
      .filter((acc) => String(acc.code || '').startsWith('11') || String(acc.code || '').startsWith('10'))
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [accounts]);

  const selectedInvoice = useMemo(
    () => invoices.find((inv) => inv.id === selectedInvoiceId) || null,
    [invoices, selectedInvoiceId]
  );

  useEffect(() => {
    if (!selectedInvoice) return;
    const due = toNumber(selectedInvoice.amount_due);
    setAmount(due);
  }, [selectedInvoice]);

  const onPay = useCallback(async () => {
    if (!selectedInvoiceId) return alert('Pilih invoice supplier');
    if (!accountId) return alert('Pilih akun pembayaran (Kas/Bank)');
    if (!Number.isFinite(amount) || amount <= 0) return alert('Jumlah pembayaran tidak valid');
    try {
      setBusyPay(true);
      await api.admin.finance.paySupplierInvoice({
        invoice_id: selectedInvoiceId,
        amount,
        account_id: accountId,
        note: note.trim() || undefined,
      });
      await load();
      setNote('');
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.message || 'Gagal melakukan pembayaran supplier');
    } finally {
      setBusyPay(false);
    }
  }, [accountId, amount, load, note, selectedInvoiceId]);

  const totalDue = useMemo(() => invoices.reduce((sum, inv) => sum + toNumber(inv.amount_due), 0), [invoices]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Bayar Supplier</h1>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Hutang Supplier (Outstanding)</p>
          <p className="text-3xl font-black text-rose-700">{formatCurrency(totalDue)}</p>
          <p className="text-xs text-slate-500 mt-2">
            Invoice unpaid: <span className="font-bold text-slate-700">{invoices.length}</span>
            {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="text-sm font-black text-slate-900">Form Pembayaran</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              value={selectedInvoiceId || ''}
              onChange={(e) => setSelectedInvoiceId(Number(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700"
            >
              <option value="">Pilih invoice supplier</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {toText(inv.Supplier?.name, 'Supplier')} • {inv.invoice_number} • Sisa{' '}
                  {formatCurrency(toNumber(inv.amount_due))}
                </option>
              ))}
            </select>

            <select
              value={accountId || ''}
              onChange={(e) => setAccountId(Number(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700"
            >
              <option value="">Pilih akun Kas/Bank</option>
              {selectableAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.code} • {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-2">
            <input
              type="number"
              value={Number.isFinite(amount) ? amount : 0}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700"
              placeholder="Jumlah pembayaran"
              min={0}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700"
              placeholder="Catatan (opsional)"
            />
          </div>

          {selectedInvoice ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-black text-slate-900">{toText(selectedInvoice.Supplier?.name, 'Supplier')}</span>
                <span className="text-slate-300">•</span>
                <span className="font-bold">{selectedInvoice.invoice_number}</span>
                <span className="text-slate-300">•</span>
                <span>Due {selectedInvoice.due_date}</span>
                <span className="text-slate-300">•</span>
                <span>Sisa {formatCurrency(toNumber(selectedInvoice.amount_due))}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busyPay}
              onClick={onPay}
              className="px-4 py-3 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-50"
            >
              {busyPay ? 'Memproses...' : 'Bayar'}
            </button>
            <button
              disabled={loading}
              onClick={load}
              className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <Link
              href="/admin/finance/laporan/invoice-supplier"
              className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50"
            >
              Lihat Daftar Invoice
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

