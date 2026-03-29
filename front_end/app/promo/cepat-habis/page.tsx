'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type ClearancePromoRow = {
  id: string;
  name: string;
  product_id: string;
  pricing_mode: 'fixed_price' | 'percent_off' | string;
  promo_unit_price?: number | null;
  discount_pct?: number | null;
  starts_at: string;
  ends_at: string;
  remaining_qty: number;
  qty_limit?: number | null;
  qty_used?: number | null;
  computed_promo_unit_price: number;
  normal_unit_price: number;
  Product?: {
    id: string;
    sku?: string;
    name?: string;
    unit?: string;
    price?: number;
    image_url?: string | null;
    stock_quantity?: number | string | null;
  } | null;
};

const DRAFT_KEY = 'clearance_checkout_draft';
const REFRESH_MS = 10_000;

export default function ClearancePromoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ClearancePromoRow[]>([]);
  const [error, setError] = useState('');
  const [qtyByPromoId, setQtyByPromoId] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async (options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) setLoading(true);
        if (!options?.silent) setError('');
        const res = await api.clearancePromos.getActive();
        const promos: ClearancePromoRow[] = Array.isArray(res.data?.promos) ? res.data.promos : [];
        if (cancelled) return;
        setRows(promos);
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'response' in e
          ? String((e as any).response?.data?.message || '')
          : '';
        if (!cancelled && !options?.silent) setError(message || 'Gagal memuat promo cepat habis.');
      } finally {
        if (!cancelled && !options?.silent) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => {
      void load({ silent: true });
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    setQtyByPromoId((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      const promoById = new Map<string, ClearancePromoRow>();
      rows.forEach((p) => promoById.set(String(p.id), p));

      Object.keys(next).forEach((promoId) => {
        const promo = promoById.get(String(promoId));
        if (!promo) return;
        const remaining = Math.max(0, Math.trunc(Number(promo.remaining_qty || 0)));
        if (next[promoId] > remaining) {
          next[promoId] = remaining;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [rows]);

  const selectedItems = useMemo(() => {
    return rows
      .map((promo) => ({
        promo,
        qty: Math.max(0, Math.trunc(Number(qtyByPromoId[promo.id] || 0))),
      }))
      .filter((row) => row.qty > 0);
  }, [qtyByPromoId, rows]);

  const estTotal = useMemo(() => {
    return selectedItems.reduce((sum, row) => sum + (Number(row.promo.computed_promo_unit_price || 0) * row.qty), 0);
  }, [selectedItems]);

  const handleCheckout = () => {
    if (selectedItems.length === 0) return;
    const items = selectedItems.map((row) => ({
      product_id: String(row.promo.product_id),
      qty: row.qty,
      clearance_promo_id: String(row.promo.id),
    }));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ items }));
    router.push('/checkout?clearance=1');
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-black text-slate-900">Promo Cepat Habis</h1>
          <p className="text-sm text-slate-500">Promo berbasis stok modal tertentu. Jika stok promo kurang, sistem akan split otomatis.</p>
        </div>
        <Link href="/catalog" className="text-xs font-black uppercase text-emerald-700">
          Katalog
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <p className="text-sm text-slate-500">Memuat promo...</p>
        </div>
      ) : error ? (
        <div className="bg-white border border-red-200 rounded-3xl p-6 shadow-sm">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <p className="text-sm text-slate-500">Belum ada promo aktif.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((promo) => {
            const productName = String(promo?.Product?.name || promo.name || 'Produk');
            const sku = String(promo?.Product?.sku || '').trim();
            const unit = String(promo?.Product?.unit || 'Pcs');
            const remaining = Math.max(0, Math.trunc(Number(promo.remaining_qty || 0)));
            const qtyLimit = promo.qty_limit === null || promo.qty_limit === undefined ? null : Math.max(0, Math.trunc(Number(promo.qty_limit || 0)));
            const qtyUsed = promo.qty_used === null || promo.qty_used === undefined ? 0 : Math.max(0, Math.trunc(Number(promo.qty_used || 0)));
            const remainingAllocation = qtyLimit === null ? null : Math.max(0, qtyLimit - qtyUsed);
            const promoPrice = Number(promo.computed_promo_unit_price || 0);
            const normalPrice = Number(promo.normal_unit_price || promo?.Product?.price || 0);
            const qty = Math.max(0, Math.trunc(Number(qtyByPromoId[promo.id] || 0)));
            const remainingPct = qtyLimit && qtyLimit > 0 ? Math.max(0, Math.min(100, (remaining / qtyLimit) * 100)) : 0;

            return (
              <div key={promo.id} className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-black text-slate-900">{productName}</h3>
                    <p className="text-xs text-slate-500">
                      {sku ? `${sku} • ` : ''}
                      {qtyLimit === null
                        ? `Sisa promo: ${remaining.toLocaleString('id-ID')} ${unit}`
                        : `Alokasi: ${qtyLimit.toLocaleString('id-ID')} • Terpakai: ${qtyUsed.toLocaleString('id-ID')} • Sisa alokasi: ${(remainingAllocation || 0).toLocaleString('id-ID')} • Sisa promo: ${remaining.toLocaleString('id-ID')} ${unit}`
                      }
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500 line-through">{formatCurrency(normalPrice)}</p>
                    <p className="text-sm font-black text-emerald-700">{formatCurrency(promoPrice)}</p>
                  </div>
                </div>

                {qtyLimit !== null && qtyLimit > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span>Sisa promo</span>
                      <span>
                        {remaining.toLocaleString('id-ID')} / {qtyLimit.toLocaleString('id-ID')} {unit}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600"
                        style={{ width: `${remainingPct}%` }}
                      />
                    </div>
                    {remainingAllocation !== null && remaining < remainingAllocation ? (
                      <p className="text-[11px] text-amber-700 font-bold">
                        Stok gudang membatasi promo (sisa alokasi {remainingAllocation.toLocaleString('id-ID')} {unit}).
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Qty</span>
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      disabled={remaining <= 0}
                      value={qty}
                      onChange={(e) => {
                        const next = Math.min(remaining, Math.max(0, Math.trunc(Number(e.target.value || 0))));
                        setQtyByPromoId((prev) => ({ ...prev, [promo.id]: next }));
                      }}
                      className="w-24 h-10 px-3 rounded-2xl border border-slate-200 text-sm font-bold text-slate-900"
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Estimasi</p>
                    <p className="text-sm font-black text-slate-900">{formatCurrency(promoPrice * qty)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Estimasi total</p>
          <p className="text-base font-black text-slate-900">{formatCurrency(estTotal)}</p>
        </div>
        <button
          data-no-3d="true"
          disabled={selectedItems.length === 0}
          onClick={handleCheckout}
          className={`h-11 px-5 rounded-2xl text-xs font-black uppercase transition-colors ${selectedItems.length === 0 ? 'bg-slate-200 text-slate-500' : 'bg-emerald-600 text-white'}`}
        >
          Checkout
        </button>
      </div>
    </div>
  );
}
