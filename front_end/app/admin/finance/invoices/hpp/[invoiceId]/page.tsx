'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { notifyOpen } from '@/lib/notify';

type InvoiceItemRow = {
  qty?: number | string | null;
  unit_cost?: number | string | null;
  OrderItem?: {
    product_id?: string | null;
    Product?: {
      sku?: string | null;
      name?: string | null;
      unit?: string | null;
    } | null;
  } | null;
};

type InvoiceDetail = {
  id?: string;
  invoice_number?: string;
  payment_status?: string;
  payment_method?: string;
  verified_at?: string | null;
  createdAt?: string | null;
  InvoiceItems?: InvoiceItemRow[];
};

type OverrideRow = {
  invoice_id: string;
  product_id: string;
  unit_cost_override: number | string;
  reason: string;
  updated_by: string;
  updatedAt: string;
  Product?: { id: string; sku?: string | null; name?: string | null; unit?: string | null } | null;
};

const toFinite = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const toMoney4 = (value: unknown) => {
  const n = toFinite(value);
  if (n === null) return null;
  return Math.round(n * 10000) / 10000;
};

export default function InvoiceHppOverridePage() {
  const allowed = useRequireRoles(['super_admin']);
  const params = useParams();
  const invoiceId = String(params?.invoiceId || '').trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [existingOverrides, setExistingOverrides] = useState<Map<string, number>>(new Map());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [lastJournal, setLastJournal] = useState<{ posted: boolean; journal_id?: number; delta_hpp: number } | null>(null);

  const load = useCallback(async () => {
    if (!allowed || !invoiceId) return;
    try {
      setLoading(true);
      setError('');
      setLastJournal(null);

      const [detailRes, overridesRes] = await Promise.all([
        api.invoices.getById(invoiceId),
        api.admin.finance.getInvoiceCostOverrides(invoiceId),
      ]);

      const detail = (detailRes as any)?.data || null;
      const overrideRows: OverrideRow[] = Array.isArray((overridesRes as any)?.data?.overrides)
        ? ((overridesRes as any).data.overrides as OverrideRow[])
        : [];

      const nextMap = new Map<string, number>();
      overrideRows.forEach((row) => {
        const productId = String(row.product_id || '').trim();
        const cost = toMoney4(row.unit_cost_override);
        if (productId && cost !== null) nextMap.set(productId, cost);
      });

      setInvoice(detail as InvoiceDetail);
      setExistingOverrides(nextMap);
      const nextInputs: Record<string, string> = {};
      nextMap.forEach((cost, productId) => {
        nextInputs[productId] = String(cost);
      });
      setInputs(nextInputs);
    } catch (e: unknown) {
      console.error(e);
      setInvoice(null);
      setExistingOverrides(new Map());
      setInputs({});
      setError('Gagal memuat data invoice / override.');
    } finally {
      setLoading(false);
    }
  }, [allowed, invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const items = Array.isArray(invoice?.InvoiceItems) ? invoice?.InvoiceItems : [];
    const map = new Map<
      string,
      {
        product_id: string;
        sku: string;
        name: string;
        unit: string;
        qty: number;
        base_total: number;
      }
    >();

    items.forEach((row) => {
      const productId = String(row?.OrderItem?.product_id || '').trim();
      if (!productId) return;
      const product = row?.OrderItem?.Product || null;
      const qty = Math.max(0, Number(row?.qty || 0));
      const unitCost = Number(row?.unit_cost || 0);
      const lineCost = qty * unitCost;
      const existing =
        map.get(productId) || {
          product_id: productId,
          sku: String(product?.sku || '-'),
          name: String(product?.name || 'Produk'),
          unit: String(product?.unit || '-'),
          qty: 0,
          base_total: 0,
        };
      existing.qty += qty;
      existing.base_total += lineCost;
      if (!existing.sku || existing.sku === '-') existing.sku = String(product?.sku || '-');
      if (!existing.name || existing.name === 'Produk') existing.name = String(product?.name || 'Produk');
      if (!existing.unit || existing.unit === '-') existing.unit = String(product?.unit || '-');
      map.set(productId, existing);
    });

    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [invoice]);

  const preview = useMemo(() => {
    let base = 0;
    let override = 0;
    grouped.forEach((row) => {
      base += row.base_total;
      const input = String(inputs[row.product_id] || '').trim();
      const overrideUnitCost = input ? Number(input) : null;
      if (overrideUnitCost !== null && Number.isFinite(overrideUnitCost)) {
        override += row.qty * overrideUnitCost;
      } else {
        override += row.base_total;
      }
    });
    const delta = override - base;
    return {
      base: Math.round(base * 100) / 100,
      override: Math.round(override * 100) / 100,
      delta: Math.round(delta * 100) / 100,
    };
  }, [grouped, inputs]);

  const save = async () => {
    if (!invoiceId) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      notifyOpen({
        variant: 'warning',
        title: 'Reason wajib diisi',
        message: 'Isi alasan koreksi untuk kebutuhan audit dan deskripsi jurnal.',
      });
      return;
    }

    const changes: Array<{ product_id: string; unit_cost_override: number | null }> = [];
    grouped.forEach((row) => {
      const productId = row.product_id;
      const raw = String(inputs[productId] || '').trim();
      const existing = existingOverrides.get(productId);

      if (!raw) {
        if (typeof existing === 'number') changes.push({ product_id: productId, unit_cost_override: null });
        return;
      }
      const parsed = toMoney4(raw);
      if (parsed === null) return;
      if (parsed < 0) return;
      if (typeof existing !== 'number' || Math.abs(existing - parsed) > 0.0001) {
        changes.push({ product_id: productId, unit_cost_override: parsed });
      }
    });

    if (changes.length === 0) {
      notifyOpen({
        variant: 'info',
        title: 'Tidak ada perubahan',
        message: 'Ubah salah satu nilai override atau hapus override yang ada, lalu simpan kembali.',
        autoCloseMs: 1400,
      });
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await api.admin.finance.updateInvoiceCostOverrides(invoiceId, {
        reason: trimmedReason,
        overrides: changes,
      });
      const payload = (res as any)?.data || {};
      const effective: OverrideRow[] = Array.isArray(payload?.effective_overrides) ? payload.effective_overrides : [];
      const nextMap = new Map<string, number>();
      effective.forEach((row) => {
        const productId = String(row.product_id || '').trim();
        const cost = toMoney4(row.unit_cost_override);
        if (productId && cost !== null) nextMap.set(productId, cost);
      });
      setExistingOverrides(nextMap);
      const nextInputs: Record<string, string> = {};
      nextMap.forEach((cost, productId) => (nextInputs[productId] = String(cost)));
      setInputs(nextInputs);
      setLastJournal(payload?.journal || null);
      const j = payload?.journal as { posted?: boolean; journal_id?: number; delta_hpp?: number } | null;
      notifyOpen({
        variant: 'success',
        title: 'Override tersimpan',
        message: j
          ? `Target delta HPP: ${formatCurrency(Number(j.delta_hpp || 0))}. ` +
            (j.posted ? `Jurnal koreksi diposting (ID ${String(j.journal_id || '-')}).` : 'Tidak perlu posting jurnal baru.')
          : 'Override berhasil disimpan.',
        autoCloseMs: 1800,
      });
    } catch (e: unknown) {
      console.error(e);
      const msg =
        typeof e === 'object' && e !== null
          ? String((e as { response?: { data?: { message?: unknown } } }).response?.data?.message || 'Gagal menyimpan override.')
          : 'Gagal menyimpan override.';
      setError(msg);
      notifyOpen({ variant: 'error', title: 'Gagal menyimpan', message: msg });
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return null;

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Memuat override HPP...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-rose-600">{error || 'Invoice tidak ditemukan.'}</p>
        <Link href="/admin/finance/invoices/hpp" className="text-sm font-bold text-emerald-700">
          Kembali
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/finance/invoices/hpp"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Kembali
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-xs font-black disabled:opacity-50"
        >
          <Save size={14} /> {saving ? 'Menyimpan...' : 'Simpan & Post Jurnal'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <h1 className="text-lg font-black text-slate-900">Override HPP Invoice</h1>
        <p className="text-xs text-slate-600">
          Invoice: <span className="font-black text-slate-900">{String(invoice.invoice_number || invoiceId)}</span> • ID:{' '}
          <span className="font-mono text-[11px]">{invoiceId}</span>
        </p>
        <p className="text-[11px] text-slate-500">
          Dibuat: {invoice.createdAt ? formatDateTime(String(invoice.createdAt)) : '-'} • Verified:{' '}
          {invoice.verified_at ? formatDateTime(String(invoice.verified_at)) : '-'}
        </p>
        {error && <p className="text-xs font-bold text-rose-700">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-600 uppercase">Base COGS</p>
          <p className="text-lg font-black text-slate-900">{formatCurrency(preview.base)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-600 uppercase">Override COGS</p>
          <p className="text-lg font-black text-slate-900">{formatCurrency(preview.override)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-600 uppercase">Delta HPP</p>
          <p className={`text-lg font-black ${preview.delta >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {formatCurrency(preview.delta)}
          </p>
          <p className="text-[11px] text-slate-500">Delta ini diposting sebagai jurnal koreksi (5100 vs 1300).</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2 items-start">
          <div>
            <h2 className="text-sm font-black text-slate-900">Override per Produk (di invoice)</h2>
            <p className="text-xs text-slate-600">Kosongkan input untuk menghapus override produk tersebut.</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-bold text-slate-600 uppercase">Reason (wajib)</p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: penyeimbangan pendapatan bulan ini"
              className="w-full lg:w-[420px] rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            />
          </div>
        </div>

        {(grouped || []).length === 0 ? (
          <p className="text-sm text-slate-500">Tidak ada item invoice.</p>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 bg-slate-50 text-[11px] font-black text-slate-600">
              <div>Produk</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Base</div>
              <div className="text-right">Override</div>
              <div className="text-right">Delta</div>
            </div>
            <div className="divide-y divide-slate-100">
              {grouped.map((row) => {
                const baseAvg = row.qty > 0 ? row.base_total / row.qty : 0;
                const input = String(inputs[row.product_id] || '').trim();
                const overrideUnitCost = input ? Number(input) : null;
                const overrideTotal =
                  overrideUnitCost !== null && Number.isFinite(overrideUnitCost) ? row.qty * overrideUnitCost : row.base_total;
                const delta = overrideTotal - row.base_total;
                const hasExisting = existingOverrides.has(row.product_id);

                return (
                  <div key={row.product_id} className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-3 items-start">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">
                        {row.sku} • {row.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {row.unit} • Base avg {formatCurrency(baseAvg)} / unit
                        {hasExisting ? ` • Override aktif` : ''}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={inputs[row.product_id] ?? ''}
                          onChange={(e) => setInputs((p) => ({ ...p, [row.product_id]: e.target.value }))}
                          placeholder="Unit cost override"
                          className="w-52 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setInputs((p) => {
                              const next = { ...p };
                              next[row.product_id] = '';
                              return next;
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-50"
                        >
                          <Trash2 size={14} /> Hapus
                        </button>
                      </div>
                    </div>
                    <div className="text-right text-xs font-bold text-slate-700">{row.qty}</div>
                    <div className="text-right text-xs font-bold text-slate-700">{formatCurrency(row.base_total)}</div>
                    <div className="text-right text-xs font-bold text-slate-700">{formatCurrency(overrideTotal)}</div>
                    <div className={`text-right text-xs font-black ${delta >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {formatCurrency(delta)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {lastJournal && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
            <p className="font-black">Jurnal koreksi</p>
            <p className="mt-1">
              Posted: <span className="font-bold">{String(lastJournal.posted)}</span> • Journal ID:{' '}
              <span className="font-bold">{lastJournal.journal_id ?? '-'}</span> • Delta target:{' '}
              <span className="font-bold">{formatCurrency(Number(lastJournal.delta_hpp || 0))}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
