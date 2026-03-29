'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';

type CartLine = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  stock_quantity: number;
  base_price: number;
  price: number;
  qty: number;
  unit_price_override?: number;
  override_reason?: string;
};

type CustomerPick = {
  id: string;
  name: string;
  whatsapp_number?: string | null;
  email?: string | null;
};

  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const round2 = (v: number) => Math.round(v * 100) / 100;

export default function AdminPosPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const router = useRouter();

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const [note, setNote] = useState('');
  const [discountPercent, setDiscountPercent] = useState<number>(0);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPick | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerPick[]>([]);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickWhatsapp, setQuickWhatsapp] = useState('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState('');

  const button3dBase = 'transition-all active:translate-y-[2px] disabled:opacity-60 disabled:cursor-not-allowed';
  const button3dPrimary = `${button3dBase} shadow-sm hover:shadow-md bg-emerald-600 hover:bg-emerald-700 text-white border-b-4 border-emerald-800 active:border-b-2`;
  const button3dNeutral = `${button3dBase} shadow-sm hover:shadow-md bg-white text-slate-700 border border-slate-200 border-b-4 border-slate-300 active:border-b-2`;
  const button3dIcon = `${button3dBase} shadow-sm hover:shadow-md bg-white border border-slate-200 border-b-4 border-slate-300 active:border-b-2`;

  const subtotal = useMemo(() => round2(cart.reduce((sum, line) => {
    const unitPrice = Number.isFinite(line.unit_price_override) ? Number(line.unit_price_override) : line.price;
    return sum + (unitPrice * line.qty);
  }, 0)), [cart]);

  const discountAmountEst = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(discountPercent || 0)));
    return round2(subtotal * (pct / 100));
  }, [discountPercent, subtotal]);

  const subtotalAfterDiscountEst = useMemo(() => round2(Math.max(0, subtotal - discountAmountEst)), [subtotal, discountAmountEst]);
  const underpayEst = useMemo(
    () => cart.length > 0 && Number(amountReceived || 0) < Number(subtotalAfterDiscountEst || 0),
    [amountReceived, cart.length, subtotalAfterDiscountEst]
  );

  const addToCart = useCallback((product: any) => {
    const productId = String(product?.id || '').trim();
    if (!productId) return;

    const nextLine: CartLine = {
      product_id: productId,
      sku: String(product?.sku || '').trim() || '-',
      name: String(product?.name || '').trim() || 'Produk',
      unit: String(product?.unit || 'Pcs'),
      stock_quantity: n(product?.stock_quantity),
      base_price: n(product?.base_price),
      price: n(product?.price),
      qty: 1,
    };

    setCart((prev) => {
      const idx = prev.findIndex((p) => p.product_id === productId);
      if (idx < 0) return [...prev, nextLine];
      const existing = prev[idx]!;
      const nextQty = existing.qty + 1;
      return prev.map((row, i) => i === idx ? { ...row, qty: nextQty } : row);
    });
  }, []);

  const handleSelectSearchResult = useCallback((product: any) => {
    addToCart(product);
    setSearchText('');
    setSearchResults([]);
    setSearchError('');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [addToCart]);

  useEffect(() => {
    if (!allowed) return;
    searchInputRef.current?.focus();
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const q = searchText.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError('');
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError('');
        const res = await api.admin.inventory.getProducts({ search: q, page: 1, limit: 10, status: 'active' });
        const payload = res.data || {};
        setSearchResults(Array.isArray(payload.products) ? payload.products : []);
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'response' in e
          ? String((e as any).response?.data?.message || '')
          : '';
        setSearchError(message || 'Gagal mencari produk.');
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [allowed, searchText]);

  useEffect(() => {
    if (!allowed) return;
    const q = customerQuery.trim();
    if (!q) {
      setCustomerResults([]);
      setCustomerSearchError('');
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        setCustomerSearchLoading(true);
        setCustomerSearchError('');
        const res = await api.admin.customers.search(q, { status: 'active', limit: 10 });
        const payload = res.data || {};
        const rows = Array.isArray(payload.customers) ? payload.customers : [];
        setCustomerResults(rows
          .map((c: any) => ({
            id: String(c?.id || ''),
            name: String(c?.name || ''),
            whatsapp_number: c?.whatsapp_number ?? null,
            email: c?.email ?? null,
          }))
          .filter((c: CustomerPick) => Boolean(c.id && c.name)));
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'response' in e
          ? String((e as any).response?.data?.message || '')
          : '';
        setCustomerSearchError(message || 'Gagal mencari customer.');
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [allowed, customerQuery]);

  const handleSelectCustomer = useCallback((c: CustomerPick) => {
    setSelectedCustomer(c);
    setCustomerQuery('');
    setCustomerResults([]);
    setCustomerSearchError('');
    window.setTimeout(() => customerInputRef.current?.focus(), 0);
  }, []);

  const openQuickCreate = useCallback((prefillName?: string) => {
    setQuickError('');
    setQuickName(String(prefillName || '').trim());
    setQuickWhatsapp('');
    setQuickCreateOpen(true);
  }, []);

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) => prev
      .map((row) => row.product_id === productId ? { ...row, qty: Math.max(1, row.qty + delta) } : row)
      .filter((row) => row.qty > 0));
  };

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((row) => row.product_id !== productId));
  };

  const updateOverride = (productId: string, value: string) => {
    const parsed = value.trim() ? Number(value) : NaN;
    setCart((prev) => prev.map((row) => {
      if (row.product_id !== productId) return row;
      if (!value.trim()) {
        const { unit_price_override, override_reason, ...rest } = row;
        return rest as CartLine;
      }
      return {
        ...row,
        unit_price_override: Number.isFinite(parsed) ? parsed : row.unit_price_override,
      };
    }));
  };

  const updateOverrideReason = (productId: string, value: string) => {
    setCart((prev) => prev.map((row) => row.product_id === productId ? { ...row, override_reason: value } : row));
  };

  const handleSubmit = async (options?: { print: boolean }) => {
    const shouldPrint = !!options?.print;
    try {
      setSubmitting(true);
      setSubmitError('');
      setSearchError('');

      if (cart.length === 0) {
        setSubmitError('Keranjang kosong.');
        return;
      }

      if (Number(amountReceived || 0) < Number(subtotalAfterDiscountEst || 0) && !selectedCustomer?.id) {
        setSubmitError('Transaksi hutang: wajib pilih customer yang terdaftar.');
        return;
      }

      const payload = {
        customer_id: selectedCustomer?.id || undefined,
        note: note.trim() || undefined,
        discount_percent: Math.min(100, Math.max(0, Number(discountPercent || 0))) || undefined,
        amount_received: Number(amountReceived || 0),
        items: cart.map((row) => ({
          product_id: row.product_id,
          qty: row.qty,
          ...(Number.isFinite(row.unit_price_override) ? { unit_price_override: Number(row.unit_price_override) } : {}),
          ...(row.override_reason && row.override_reason.trim() ? { override_reason: row.override_reason.trim() } : {}),
        })),
      };

      const res = await api.admin.pos.createSale(payload);
      const id = String(res.data?.id || '').trim();
      if (!id) {
        setSubmitError('Transaksi tersimpan, tapi response id kosong.');
        return;
      }
      setCart([]);
      setAmountReceived(0);
      setSelectedCustomer(null);
      setCustomerQuery('');
      setCustomerResults([]);
      setNote('');
      setDiscountPercent(0);

      if (shouldPrint) {
        const printUrl = `/admin/pos/${encodeURIComponent(id)}/print?autoPrint=1`;
        router.push(printUrl);
        return;
      }

      router.push(`/admin/pos/${encodeURIComponent(id)}`);
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setSubmitError(message || 'Gagal menyimpan transaksi POS.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="p-2 hover:bg-slate-100 rounded-full text-slate-600">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-black text-slate-900">POS Kasir</h1>
          <p className="text-slate-500 text-sm">Transaksi eceran offline + keluar barang otomatis</p>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-2">
            <Link
              href="/admin/pos/history"
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${button3dNeutral}`}
            >
              Riwayat
            </Link>
            <Link
              href="/admin/pos"
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${button3dNeutral}`}
              onClick={() => searchInputRef.current?.focus()}
            >
              <Printer size={14} />
              Fokus Cari
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
              <Search size={14} />
              Cari Produk
	            </div>
	            <div className="relative">
	              <input
	                ref={searchInputRef}
	                value={searchText}
	                onChange={(e) => setSearchText(e.target.value)}
	                placeholder="Ketik nama / SKU..."
	                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
	              />
	              {searchResults.length > 0 ? (
	                <div className="absolute z-20 mt-2 w-full divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-72 overflow-y-auto">
	                  {searchResults.map((p, idx) => (
	                    <button
	                      key={String(p?.id || p?.sku || idx)}
	                      type="button"
	                      onClick={() => handleSelectSearchResult(p)}
	                      className="w-full text-left px-4 py-3 hover:bg-slate-50"
	                    >
	                      <div className="flex items-center justify-between gap-3">
	                        <div>
	                          <p className="text-sm font-black text-slate-900">{String(p?.name || 'Produk')}</p>
	                          <p className="text-[11px] text-slate-500">SKU: {String(p?.sku || '-')} • Stok: {String(p?.stock_quantity ?? '-')}</p>
	                        </div>
	                        <div className="text-sm font-black text-slate-900">{formatCurrency(n(p?.price))}</div>
	                      </div>
	                    </button>
	                  ))}
	                </div>
	              ) : null}
	            </div>
	            {searchLoading ? <p className="text-xs text-slate-500">Mencari...</p> : null}
	            {searchError ? <p className="text-xs text-rose-600">{searchError}</p> : null}
	          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Keranjang</p>
                <p className="text-sm text-slate-500">Total item: {cart.reduce((sum, r) => sum + r.qty, 0)}</p>
              </div>
              <button
                type="button"
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-60"
              >
                <Trash2 size={14} />
                Clear
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada item.</p>
            ) : (
              <div className="space-y-3">
                {cart.map((row) => {
                  const unitPrice = Number.isFinite(row.unit_price_override) ? Number(row.unit_price_override) : row.price;
                  const lineTotal = round2(unitPrice * row.qty);
                  const overrideInvalid =
                    (Number.isFinite(row.unit_price_override) && (Number(row.unit_price_override) > row.price || Number(row.unit_price_override) < row.base_price));

                  return (
                    <div key={row.product_id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{row.name}</p>
                          <p className="text-[11px] text-slate-500">SKU: {row.sku} • Stok: {row.stock_quantity} • Modal: {formatCurrency(row.base_price)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(row.product_id)}
                          className="text-slate-400 hover:text-rose-600"
                          aria-label="Remove"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Qty</label>
                          <div className="mt-1 flex items-center gap-2">
                            <button type="button" onClick={() => updateQty(row.product_id, -1)} className={`h-9 w-9 rounded-lg grid place-items-center ${button3dIcon}`}>
                              <Minus size={14} />
                            </button>
                            <div className="min-w-12 text-center text-sm font-black text-slate-900">{row.qty}</div>
                            <button type="button" onClick={() => updateQty(row.product_id, +1)} className={`h-9 w-9 rounded-lg grid place-items-center ${button3dIcon}`}>
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
	                        <div>
	                          <label className="text-[10px] font-bold text-slate-500 uppercase">Harga (Override)</label>
	                          <input
	                            value={Number.isFinite(row.unit_price_override) ? String(row.unit_price_override) : ''}
	                            onChange={(e) => updateOverride(row.product_id, e.target.value)}
	                            placeholder={`Normal: ${row.price}`}
	                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
	                          />
	                          {Number.isFinite(row.unit_price_override) ? (
	                            <textarea
	                              value={row.override_reason || ''}
	                              onChange={(e) => updateOverrideReason(row.product_id, e.target.value)}
	                              placeholder="Alasan override (opsional)"
	                              rows={2}
	                              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
	                            />
	                          ) : null}
	                          {overrideInvalid ? (
	                            <p className="mt-1 text-[11px] text-rose-600">
	                              Override tidak valid (maks {formatCurrency(row.price)} / min modal {formatCurrency(row.base_price)}).
	                            </p>
	                          ) : null}
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Line Total</label>
                          <p className="mt-2 text-sm font-black text-slate-900">{formatCurrency(lineTotal)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`bg-white rounded-3xl p-5 space-y-4 shadow-sm border ${underpayEst ? 'border-rose-200' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-black uppercase tracking-widest ${underpayEst ? 'text-rose-700' : 'text-slate-500'}`}>
                  Customer {underpayEst ? '(Wajib untuk Hutang)' : '(Opsional)'}
                </p>
                <p className={`text-[11px] ${underpayEst ? 'text-rose-700' : 'text-slate-500'}`}>
                  {underpayEst
                    ? 'Jika transaksi kurang bayar (hutang), wajib pilih customer yang terdaftar agar bisa dilacak.'
                    : 'Kosong tidak masalah. Isi jika ingin mencatat customer yang sedang dilayani.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerQuery('');
                    setCustomerResults([]);
                    setCustomerSearchError('');
                    window.setTimeout(() => customerInputRef.current?.focus(), 0);
                  }}
                  className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide ${button3dNeutral}`}
                  title="Clear customer"
                >
                  Clear
                </button>
              </div>
            </div>

            {selectedCustomer ? (
              <div className={`rounded-2xl p-3 border ${underpayEst ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-sm font-black text-slate-900">{selectedCustomer.name}</p>
                <p className="text-[11px] text-slate-600">
                  {selectedCustomer.whatsapp_number ? `WA: ${selectedCustomer.whatsapp_number}` : 'WA: -'}
                  {selectedCustomer.email ? ` • ${selectedCustomer.email}` : ''}
                </p>
              </div>
            ) : (
              <div className={`rounded-2xl p-3 border ${underpayEst ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-xs text-slate-700">Belum memilih customer.</p>
              </div>
            )}

            <div className="relative">
              <input
                ref={customerInputRef}
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Cari customer (nama / WhatsApp)..."
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {(customerResults.length > 0) ? (
                <div className="absolute z-20 mt-2 w-full divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50"
                    >
                      <p className="text-sm font-black text-slate-900">{c.name}</p>
                      <p className="text-[11px] text-slate-500">{c.whatsapp_number || '-'}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {customerSearchLoading ? <p className="text-xs text-slate-500">Mencari customer...</p> : null}
            {customerSearchError ? <p className="text-xs text-rose-600">{customerSearchError}</p> : null}

            {customerQuery.trim() && !customerSearchLoading && customerResults.length === 0 ? (
              <button
                type="button"
                onClick={() => openQuickCreate(customerQuery)}
                className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${button3dNeutral}`}
              >
                Tambah Customer Baru: &quot;{customerQuery.trim()}&quot;
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openQuickCreate('')}
              className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${button3dNeutral}`}
            >
              Daftarkan Customer (Shortcut)
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Pembayaran</p>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Subtotal (estimasi)</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Diskon</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(discountAmountEst)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Subtotal setelah diskon</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(subtotalAfterDiscountEst)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Uang dibayar</span>
                <span className="text-sm font-black text-slate-900">{formatCurrency(amountReceived)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Catatan: total final dihitung oleh backend (termasuk pajak jika aktif).
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Diskon (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value || 0))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Uang dibayar</label>
                <input
                  type="number"
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(Number(e.target.value || 0))}
                  placeholder="Nominal dibayar customer"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Catatan (Opsional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan transaksi (opsional)"
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm"
                rows={2}
              />
            </div>

            {submitError ? <p className="text-xs text-rose-600 whitespace-pre-wrap">{submitError}</p> : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSubmit({ print: true })}
                disabled={submitting || cart.length === 0}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${button3dPrimary}`}
                title="Simpan transaksi dan buka struk untuk print (pilih printer thermal bluetooth dari dialog print browser)."
              >
                <Printer size={16} />
                {submitting ? 'Menyimpan...' : 'Bayar & Print'}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit({ print: false })}
                disabled={submitting || cart.length === 0}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${button3dNeutral}`}
              >
                {submitting ? 'Menyimpan...' : 'Bayar & Simpan'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {quickCreateOpen ? (
        <div className="fixed inset-0 z-[100] bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-slate-900">Daftarkan Customer (Shortcut)</h2>
              <button
                type="button"
                onClick={() => setQuickCreateOpen(false)}
                className="text-xs font-black uppercase tracking-wide text-slate-500 hover:text-slate-700"
              >
                Tutup
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Nama</label>
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  placeholder="Nama customer"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">WhatsApp (Opsional)</label>
                <input
                  value={quickWhatsapp}
                  onChange={(e) => setQuickWhatsapp(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  placeholder="08xxxxxxxxxx (boleh kosong)"
                />
              </div>
            </div>

            {quickError ? <p className="text-xs text-rose-600 whitespace-pre-wrap">{quickError}</p> : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    setQuickSubmitting(true);
                    setQuickError('');
                    if (!quickName.trim()) {
                      setQuickError('Nama wajib diisi.');
                      return;
                    }
                    const res = await api.admin.customers.quickCreate({
                      name: quickName.trim(),
                      ...(quickWhatsapp.trim() ? { whatsapp_number: quickWhatsapp.trim() } : {}),
                    });
                    const c = (res.data || {}).customer || {};
                    const picked: CustomerPick = {
                      id: String(c.id || ''),
                      name: String(c.name || ''),
                      whatsapp_number: c.whatsapp_number ?? null,
                      email: c.email ?? null,
                    };
                    if (!picked.id || !picked.name) {
                      setQuickError('Customer tersimpan, tapi response tidak lengkap.');
                      return;
                    }
                    setSelectedCustomer(picked);
                    setQuickCreateOpen(false);
                    setCustomerQuery('');
                    setCustomerResults([]);
                    setCustomerSearchError('');
                  } catch (e: unknown) {
                    const message = typeof e === 'object' && e && 'response' in e
                      ? String((e as any).response?.data?.message || '')
                      : '';
                    setQuickError(message || 'Gagal membuat customer.');
                  } finally {
                    setQuickSubmitting(false);
                  }
                }}
                disabled={quickSubmitting}
                className={`flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${button3dPrimary}`}
              >
                {quickSubmitting ? 'Menyimpan...' : 'Simpan & Pilih'}
              </button>
              <button
                type="button"
                onClick={() => setQuickCreateOpen(false)}
                className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${button3dNeutral}`}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
