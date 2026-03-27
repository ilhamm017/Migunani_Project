'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Plus, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  price?: number | string | null;
  unit?: string | null;
};

type ClearancePromoRow = {
  id: string;
  name: string;
  product_id: string;
  target_unit_cost: number | string;
  pricing_mode: 'fixed_price' | 'percent_off' | string;
  promo_unit_price?: number | string | null;
  discount_pct?: number | string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  remaining_qty?: number | string | null;
  Product?: {
    id: string;
    sku?: string | null;
    name?: string | null;
    unit?: string | null;
    price?: number | string | null;
    image_url?: string | null;
  } | null;
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateTimeLocalInputValue = (date: Date): string => {
  const safe = new Date(date);
  if (!Number.isFinite(safe.getTime())) return '';
  return `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}T${pad2(safe.getHours())}:${pad2(safe.getMinutes())}`;
};

const parseDateTimeLocalInput = (value: string): Date | null => {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute
  ) {
    return null;
  }
  return localDate;
};

const computePromoUnitPrice = (promo: ClearancePromoRow): number => {
  const pricingMode = String(promo.pricing_mode || '');
  if (pricingMode === 'fixed_price') return Math.round(Number(promo.promo_unit_price || 0) * 100) / 100;
  const normalPrice = Number(promo.Product?.price || 0);
  const pct = Number(promo.discount_pct || 0);
  if (!Number.isFinite(normalPrice) || normalPrice <= 0) return 0;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 0;
  return Math.round(normalPrice * (1 - pct / 100));
};

export default function AdminClearancePromosPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'super_admin';

  const [promos, setPromos] = useState<ClearancePromoRow[]>([]);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [processingPromoId, setProcessingPromoId] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productLoading, setProductLoading] = useState(false);

  const [newName, setNewName] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newTargetUnitCost, setNewTargetUnitCost] = useState('7000');
  const [newPricingMode, setNewPricingMode] = useState<'fixed_price' | 'percent_off'>('fixed_price');
  const [newPromoUnitPrice, setNewPromoUnitPrice] = useState('7000');
  const [newDiscountPct, setNewDiscountPct] = useState('10');
  const [newStartsAt, setNewStartsAt] = useState('');
  const [newEndsAt, setNewEndsAt] = useState('');
  const [newIsActive, setNewIsActive] = useState(true);

  useEffect(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const in7days = new Date(now);
    in7days.setDate(in7days.getDate() + 7);
    setNewStartsAt(toDateTimeLocalInputValue(now));
    setNewEndsAt(toDateTimeLocalInputValue(in7days));
  }, []);

  const loadProductOptions = useCallback(async (query?: string) => {
    try {
      setProductLoading(true);
      setError('');
      const res = await api.admin.inventory.getProducts({
        page: 1,
        limit: 20,
        search: query?.trim() || undefined,
        status: 'active',
      });
      const rows = Array.isArray(res.data?.products) ? (res.data.products as any[]) : [];
      setProductOptions(
        rows.map((row) => ({
          id: String(row.id),
          name: String(row.name || ''),
          sku: String(row.sku || ''),
          price: row.price ?? null,
          unit: row.unit ?? null,
        }))
      );
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setProductOptions([]);
      setError(err?.response?.data?.message || 'Gagal memuat daftar produk');
    } finally {
      setProductLoading(false);
    }
  }, []);

  const loadPromos = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.clearancePromos.getAll({ include_inactive: includeInactive });
      const rows = Array.isArray(res.data?.promos) ? (res.data.promos as ClearancePromoRow[]) : [];
      setPromos(rows);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setPromos([]);
      setError(err?.response?.data?.message || 'Gagal memuat promo cepat habis');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    if (!allowed) return;
    void loadPromos();
  }, [allowed, loadPromos]);

  const handleCreate = async () => {
    if (!isSuperAdmin) return;

    const name = newName.trim();
    const productId = String(newProductId || '').trim();
    const targetUnitCost = Number(newTargetUnitCost);
    const startsAt = parseDateTimeLocalInput(newStartsAt);
    const endsAt = parseDateTimeLocalInput(newEndsAt);

    if (!name) {
      setError('Nama promo wajib diisi.');
      return;
    }
    if (!productId) {
      setError('Pilih produk terlebih dahulu.');
      return;
    }
    if (!Number.isFinite(targetUnitCost) || targetUnitCost < 0) {
      setError('Target modal (unit cost) tidak valid.');
      return;
    }
    if (!startsAt || !endsAt || startsAt.getTime() >= endsAt.getTime()) {
      setError('Periode promo tidak valid (ends_at harus lebih besar dari starts_at).');
      return;
    }

    const payload: any = {
      name,
      product_id: productId,
      target_unit_cost: targetUnitCost,
      pricing_mode: newPricingMode,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_active: newIsActive,
    };

    if (newPricingMode === 'fixed_price') {
      const promoUnitPrice = Number(newPromoUnitPrice);
      if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) {
        setError('Harga promo wajib diisi (fixed price).');
        return;
      }
      payload.promo_unit_price = promoUnitPrice;
    } else {
      const discountPct = Number(newDiscountPct);
      if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) {
        setError('Diskon (%) wajib diisi (1-99.99).');
        return;
      }
      payload.discount_pct = discountPct;
    }

    try {
      setCreating(true);
      setError('');
      setActionMessage('');
      await api.admin.clearancePromos.create(payload);
      setActionMessage('Promo cepat habis berhasil dibuat.');
      setNewName('');
      await loadPromos();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal membuat promo cepat habis');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (promo: ClearancePromoRow) => {
    if (!isSuperAdmin) return;
    const promoId = String(promo.id || '').trim();
    if (!promoId) return;

    try {
      setProcessingPromoId(promoId);
      setError('');
      setActionMessage('');
      await api.admin.clearancePromos.update(promoId, { is_active: !promo.is_active });
      setActionMessage(`Promo ${promo.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await loadPromos();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal memperbarui status promo');
    } finally {
      setProcessingPromoId('');
    }
  };

  const rowsWithComputedPrice = useMemo(() => {
    return promos.map((promo) => ({
      ...promo,
      computed_promo_unit_price: computePromoUnitPrice(promo),
    }));
  }, [promos]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
            <ArrowLeft size={14} /> Kembali ke Dashboard Admin
          </Link>
          <h1 className="text-2xl font-black text-slate-900 mt-2">Manajemen Promo Cepat Habis</h1>
          <p className="text-sm text-slate-500 mt-1">
            Promo berbasis modal (batch cost layer). Checkout akan otomatis split promo + normal jika stok modal target kurang.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPromos()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Tampilkan nonaktif
        </label>
        <Link
          href="/promo/cepat-habis"
          className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200"
        >
          <Layers size={14} /> Lihat Halaman Customer
        </Link>
      </div>

      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-slate-900">Buat Promo Baru</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Cari produk (nama/SKU)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void loadProductOptions(productSearch)}
              disabled={productLoading}
              className="inline-flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
            >
              {productLoading ? 'Mencari...' : 'Cari Produk'}
            </button>
            <select
              value={newProductId}
              onChange={(event) => setNewProductId(event.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">Pilih produk promo</option>
              {productOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} {option.sku ? `(${option.sku})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nama promo (contoh: Stok Diskon Modal 7000)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm md:col-span-2"
            />
            <input
              type="number"
              step="0.0001"
              value={newTargetUnitCost}
              onChange={(event) => setNewTargetUnitCost(event.target.value)}
              placeholder="Target modal (unit cost)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
            <select
              value={newPricingMode}
              onChange={(event) => setNewPricingMode(event.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="fixed_price">Harga Fix</option>
              <option value="percent_off">Diskon %</option>
            </select>
            {newPricingMode === 'fixed_price' ? (
              <input
                type="number"
                value={newPromoUnitPrice}
                onChange={(event) => setNewPromoUnitPrice(event.target.value)}
                placeholder="Harga promo (Rp)"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            ) : (
              <input
                type="number"
                step="0.01"
                value={newDiscountPct}
                onChange={(event) => setNewDiscountPct(event.target.value)}
                placeholder="Diskon (%)"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            )}
            <input
              type="datetime-local"
              value={newStartsAt}
              onChange={(event) => setNewStartsAt(event.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={newEndsAt}
              onChange={(event) => setNewEndsAt(event.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <input
                type="checkbox"
                checked={newIsActive}
                onChange={(event) => setNewIsActive(event.target.checked)}
              />
              Aktif
            </label>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
            >
              <Plus size={12} /> {creating ? 'Membuat...' : 'Buat Promo'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900">Daftar Promo</h2>
          <p className="text-xs text-slate-500">{rowsWithComputedPrice.length} promo</p>
        </div>

        <div className="space-y-2">
          {rowsWithComputedPrice.length === 0 ? (
            <div className="text-sm text-slate-500">
              {loading ? 'Memuat promo...' : 'Belum ada promo cepat habis.'}
            </div>
          ) : (
            rowsWithComputedPrice.map((promo) => {
              const productName = String(promo.Product?.name || '');
              const productSku = String(promo.Product?.sku || '');
              const normalPrice = Number(promo.Product?.price || 0);
              const computedPromoPrice = Number((promo as any).computed_promo_unit_price || 0);
              const remainingQty = Math.max(0, Math.trunc(Number(promo.remaining_qty || 0)));
              const isProcessing = processingPromoId === promo.id;
              const isActiveNow =
                promo.is_active &&
                Number.isFinite(new Date(promo.starts_at).getTime()) &&
                Number.isFinite(new Date(promo.ends_at).getTime()) &&
                Date.now() >= new Date(promo.starts_at).getTime() &&
                Date.now() <= new Date(promo.ends_at).getTime();

              return (
                <div
                  key={promo.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        {isActiveNow ? 'Aktif Sekarang' : promo.is_active ? 'Aktif (Terjadwal)' : 'Nonaktif'}
                      </p>
                      <h3 className="text-sm font-black text-slate-900 mt-0.5">{promo.name}</h3>
                      <p className="text-xs text-slate-600 mt-1">
                        {productName || 'Produk'} {productSku ? `(${productSku})` : ''}
                      </p>
                    </div>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => {
                          void handleToggleActive(promo);
                        }}
                        className={`inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border disabled:opacity-60 ${promo.is_active
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                      >
                        {promo.is_active ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                        {isProcessing ? 'Memproses...' : promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Target Modal</p>
                      <p className="font-black text-slate-900 mt-0.5">{formatCurrency(Number(promo.target_unit_cost || 0))}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Harga Promo</p>
                      <p className="font-black text-slate-900 mt-0.5">{formatCurrency(computedPromoPrice)}</p>
                      {normalPrice > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">Normal {formatCurrency(normalPrice)}</p>
                      )}
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sisa Stok Promo</p>
                      <p className="font-black text-slate-900 mt-0.5">{remainingQty.toLocaleString('id-ID')}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Periode</p>
                      <p className="text-[11px] font-bold text-slate-700 mt-0.5">{formatDateTime(promo.starts_at)}</p>
                      <p className="text-[11px] font-bold text-slate-700">{formatDateTime(promo.ends_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}

