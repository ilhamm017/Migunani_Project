'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, History as HistoryIcon, Package, Plus, Save, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';

interface SupplierRow {
  id: number;
  name: string;
  contact: string | null;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  stock_quantity: number;
  min_stock: number;
}

interface BackorderSuggestion {
  id: string;
  sku: string;
  name: string;
  stock: number;
  shortage: number;
}

interface BackorderItemRow {
  product_id: string;
  product_name: string;
  sku: string;
  stock_quantity: number;
  shortage_qty: number;
}

interface BackorderOrderRow {
  shortage_items?: BackorderItemRow[];
  status_label?: 'fulfilled' | 'backorder' | 'preorder' | 'unallocated' | string;
}

interface PreorderItemDraft {
  product: ProductRow;
  qty: number;
  note?: string;
}

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function SupplierPreorderCreatePage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');
  const router = useRouter();

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');

  const [mode, setMode] = useState<'restock' | 'backorder'>('restock');

  const [restockPage, setRestockPage] = useState(1);
  const [restockLimit, setRestockLimit] = useState(50);
  const [restockSearch, setRestockSearch] = useState('');
  const [debouncedRestockSearch, setDebouncedRestockSearch] = useState('');
  const [restockRows, setRestockRows] = useState<ProductRow[]>([]);
  const [restockTotalPages, setRestockTotalPages] = useState(1);
  const [loadingRestock, setLoadingRestock] = useState(true);
  const [selectedRestockIds, setSelectedRestockIds] = useState<Set<string>>(new Set());
  const restockMasterCheckboxRef = useRef<HTMLInputElement | null>(null);

  const [backorderRows, setBackorderRows] = useState<BackorderSuggestion[]>([]);
  const [loadingBackorder, setLoadingBackorder] = useState(true);
  const [backorderSearch, setBackorderSearch] = useState('');
  const [selectedBackorderIds, setSelectedBackorderIds] = useState<Set<string>>(new Set());
  const backorderMasterCheckboxRef = useRef<HTMLInputElement | null>(null);

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [items, setItems] = useState<PreorderItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadSuppliers = useCallback(async () => {
    try {
      setLoadingSuppliers(true);
      const res = await api.admin.inventory.getSuppliers();
      setSuppliers(res.data?.suppliers || []);
    } catch {
      setSuppliers([]);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRestockSearch(restockSearch.trim()), 400);
    return () => clearTimeout(timer);
  }, [restockSearch]);

  const loadRestockSuggestions = useCallback(async () => {
    try {
      setLoadingRestock(true);
      const res = await api.admin.inventory.getRestockSuggestions({
        page: restockPage,
        limit: restockLimit,
        search: debouncedRestockSearch || undefined,
        status: 'active',
      });
      const rows = (res.data?.products || []) as ProductRow[];
      setRestockRows(rows);
      setRestockTotalPages(Math.max(1, Number(res.data?.totalPages || 1)));
    } catch {
      setRestockRows([]);
      setRestockTotalPages(1);
    } finally {
      setLoadingRestock(false);
    }
  }, [debouncedRestockSearch, restockLimit, restockPage]);

  const loadBackorderSuggestions = useCallback(async () => {
    try {
      setLoadingBackorder(true);
      const res = await api.allocation.getPending({ scope: 'shortage' });
      const orders = (res.data?.rows || []) as BackorderOrderRow[];

      const aggregated = new Map<string, BackorderSuggestion>();
      orders.forEach((order) => {
        const label = String(order?.status_label || 'unallocated');
        if (label !== 'unallocated' && label !== 'preorder' && label !== 'backorder') return;
        (order.shortage_items || []).forEach((item) => {
          const productId = item.product_id;
          const prev = aggregated.get(productId);
          const shortage = Number(item.shortage_qty || 0);
          if (prev) {
            prev.shortage += shortage;
          } else {
            aggregated.set(productId, {
              id: productId,
              sku: item.sku,
              name: item.product_name,
              stock: Number(item.stock_quantity || 0),
              shortage,
            });
          }
        });
      });

      setBackorderRows(Array.from(aggregated.values()).sort((a, b) => b.shortage - a.shortage));
    } catch {
      setBackorderRows([]);
    } finally {
      setLoadingBackorder(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadSuppliers();
    void loadBackorderSuggestions();
  }, [allowed, loadSuppliers, loadBackorderSuggestions]);

  useEffect(() => {
    if (!allowed) return;
    void loadRestockSuggestions();
    setSelectedRestockIds(new Set());
  }, [allowed, loadRestockSuggestions]);

  useEffect(() => {
    if (!restockMasterCheckboxRef.current) return;
    const isAll = restockRows.length > 0 && restockRows.every((p) => selectedRestockIds.has(p.id));
    const isSome = restockRows.some((p) => selectedRestockIds.has(p.id));
    restockMasterCheckboxRef.current.indeterminate = isSome && !isAll;
  }, [restockRows, selectedRestockIds]);

  const filteredBackorderRows = useMemo(() => {
    const q = backorderSearch.trim().toLowerCase();
    if (!q) return backorderRows;
    return backorderRows.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
  }, [backorderRows, backorderSearch]);

  useEffect(() => {
    if (!backorderMasterCheckboxRef.current) return;
    const isAll = filteredBackorderRows.length > 0 && filteredBackorderRows.every((p) => selectedBackorderIds.has(p.id));
    const isSome = filteredBackorderRows.some((p) => selectedBackorderIds.has(p.id));
    backorderMasterCheckboxRef.current.indeterminate = isSome && !isAll;
  }, [filteredBackorderRows, selectedBackorderIds]);

  const upsertItem = (product: ProductRow, qty: number) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.max(1, Number(qty || 1)) };
        return next;
      }
      return [...prev, { product, qty: Math.max(1, Number(qty || 1)) }];
    });
  };

  const removeItem = (productId: string) => setItems((prev) => prev.filter((p) => p.product.id !== productId));

  const addSelectedRestock = () => {
    const selected = restockRows.filter((p) => selectedRestockIds.has(p.id));
    selected.forEach((p) => {
      const suggested = Math.max(0, Number(p.min_stock || 0) - Number(p.stock_quantity || 0));
      upsertItem(p, suggested > 0 ? suggested : 1);
    });
    setSelectedRestockIds(new Set());
  };

  const addSelectedBackorder = () => {
    const selected = filteredBackorderRows.filter((p) => selectedBackorderIds.has(p.id));
    selected.forEach((p) => {
      const product: ProductRow = {
        id: p.id,
        sku: p.sku,
        name: p.name,
        stock_quantity: p.stock,
        min_stock: 0,
      };
      upsertItem(product, p.shortage > 0 ? p.shortage : 1);
    });
    setSelectedBackorderIds(new Set());
  };

  const doProductSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      setSearching(true);
      const res = await api.admin.inventory.getProducts({ limit: 20, search: query, status: 'active' });
      setProductResults((res.data?.products || []) as ProductRow[]);
    } catch {
      setProductResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void doProductSearch(productSearch), 400);
    return () => clearTimeout(timer);
  }, [productSearch, doProductSearch]);

  const createDraft = async () => {
    if (!supplierId) {
      setErrorMessage('Supplier wajib dipilih.');
      return;
    }
    if (items.length <= 0) {
      setErrorMessage('Masukkan minimal satu barang.');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage('');
      const payload = {
        supplier_id: Number(supplierId),
        notes: notes.trim() || undefined,
        items: items.map((i) => ({
          product_id: i.product.id,
          qty: i.qty,
          ...(i.note ? { note: i.note } : {}),
        })),
      };
      const res = await api.admin.procurement.createPreorder(payload);
      const id = String(res.data?.id || '');
      if (id) router.push(`/admin/warehouse/po/${id}`);
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setErrorMessage(err?.response?.data?.message || 'Gagal membuat draft PO.');
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="warehouse-title !mb-1 flex items-center gap-2">
            <Package className="text-emerald-600" />
            PO (PreOrder Supplier)
          </h1>
          <p className="warehouse-subtitle !mb-0">
            Rekap barang untuk pemesanan ke supplier. Tidak menambah stok.
          </p>
        </div>
        <Link
          href="/admin/warehouse/po/history"
          className="rounded-2xl bg-white border border-slate-200 text-slate-600 text-sm font-black px-6 py-3 inline-flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
        >
          <HistoryIcon size={18} />
          Riwayat PO
        </Link>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium shrink-0">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <div className="lg:col-span-1 min-h-0 order-2 lg:order-1">
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm h-full flex flex-col">
            <h3 className="font-bold text-slate-900 mb-3">Header</h3>
            <label className="text-xs font-black text-slate-500 uppercase tracking-wider mb-1">Supplier (Wajib)</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={loadingSuppliers}
              className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
            >
              <option value="">Pilih Supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <label className="text-xs font-black text-slate-500 uppercase tracking-wider mt-4 mb-1">Catatan (Opsional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none resize-none"
              placeholder="Contoh: minta dikirim besok / urgent / dll"
            />

            <div className="flex items-center justify-between mt-6 mb-2">
              <h3 className="font-bold text-slate-900">Daftar Barang ({items.length})</h3>
              {items.length > 0 && (
                <button onClick={() => setItems([])} className="text-xs text-rose-500 font-medium hover:underline inline-flex items-center gap-1">
                  <Trash2 size={14} /> Hapus Semua
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                <Package size={48} className="mb-2 opacity-20" />
                <p className="text-sm text-center px-4">Belum ada barang dipilih.</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
                {items.map((it) => (
                  <div key={it.product.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">{it.product.sku}</div>
                        <div className="font-black text-slate-900 truncate">{it.product.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Stok: <span className="font-bold">{Number(it.product.stock_quantity || 0)}</span>
                          {Number(it.product.min_stock || 0) > 0 && (
                            <>
                              {' '}| Min: <span className="font-bold">{Number(it.product.min_stock || 0)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button onClick={() => removeItem(it.product.id)} className="text-rose-500 hover:underline text-xs font-bold">
                        Hapus
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty</label>
                        <input
                          type="number"
                          min={1}
                          value={it.qty}
                          onChange={(e) => {
                            const nextQty = Math.max(1, Number(e.target.value || 1));
                            setItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, qty: nextQty } : p));
                          }}
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Note (opsional)</label>
                        <input
                          value={it.note || ''}
                          onChange={(e) => setItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, note: e.target.value } : p))}
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="contoh: merk A"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={createDraft}
              disabled={saving}
              className="mt-4 rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Save size={18} />
              )}
              Simpan Draft PO
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 min-h-0 order-1 lg:order-2 flex flex-col gap-4">
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 p-1">
                <button
                  onClick={() => setMode('restock')}
                  className={`px-4 py-2 rounded-2xl text-sm font-black transition-all ${mode === 'restock' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-600'}`}
                >
                  Stok Menipis
                </button>
                <button
                  onClick={() => setMode('backorder')}
                  className={`px-4 py-2 rounded-2xl text-sm font-black transition-all ${mode === 'backorder' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-600'}`}
                >
                  Backorder
                </button>
              </div>
              {mode === 'restock' ? (
                <button
                  onClick={addSelectedRestock}
                  disabled={selectedRestockIds.size === 0}
                  className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-40 hover:bg-emerald-700 transition-all"
                >
                  <Plus size={18} />
                  Tambah ({selectedRestockIds.size})
                </button>
              ) : (
                <button
                  onClick={addSelectedBackorder}
                  disabled={selectedBackorderIds.size === 0}
                  className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-40 hover:bg-emerald-700 transition-all"
                >
                  <Plus size={18} />
                  Tambah ({selectedBackorderIds.size})
                </button>
              )}
            </div>

            {mode === 'restock' ? (
              <>
                <div className="flex flex-col md:flex-row gap-3 items-center mt-4">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      value={restockSearch}
                      onChange={(e) => setRestockSearch(e.target.value)}
                      placeholder="Cari (stok menipis)..."
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                    />
                  </div>
                  <select
                    value={restockLimit}
                    onChange={(e) => setRestockLimit(Number(e.target.value))}
                    className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <div className="mt-4 max-h-[420px] overflow-y-auto pr-1">
                  {loadingRestock ? (
                    <div className="flex items-center justify-center p-16 text-slate-400">
                      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : restockRows.length === 0 ? (
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                      <AlertTriangle size={18} className="text-amber-500" />
                      Tidak ada saran restock.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-xs text-slate-500">
                          <th className="py-2 w-10">
                            <input
                              ref={restockMasterCheckboxRef}
                              type="checkbox"
                              checked={restockRows.length > 0 && restockRows.every((p) => selectedRestockIds.has(p.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedRestockIds(new Set(restockRows.map((p) => p.id)));
                                else setSelectedRestockIds(new Set());
                              }}
                            />
                          </th>
                          <th className="py-2">SKU</th>
                          <th className="py-2">Produk</th>
                          <th className="py-2 w-24">Stok</th>
                          <th className="py-2 w-24">Min</th>
                          <th className="py-2 w-28">Saran Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {restockRows.map((p) => {
                          const suggested = Math.max(0, Number(p.min_stock || 0) - Number(p.stock_quantity || 0));
                          return (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedRestockIds.has(p.id)}
                                  onChange={(e) => {
                                    setSelectedRestockIds((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(p.id);
                                      else next.delete(p.id);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="py-2 font-mono text-xs uppercase tracking-wider text-slate-600">{p.sku}</td>
                              <td className="py-2 font-bold text-slate-900">{p.name}</td>
                              <td className="py-2">{Number(p.stock_quantity || 0)}</td>
                              <td className="py-2">{Number(p.min_stock || 0)}</td>
                              <td className="py-2 font-black text-emerald-700">{suggested}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {restockTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <button
                      disabled={restockPage === 1}
                      onClick={() => setRestockPage((p) => Math.max(1, p - 1))}
                      className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-black disabled:opacity-30"
                    >
                      Prev
                    </button>
                    <div className="text-sm text-slate-600 font-bold">Halaman {restockPage} / {restockTotalPages}</div>
                    <button
                      disabled={restockPage === restockTotalPages}
                      onClick={() => setRestockPage((p) => Math.min(restockTotalPages, p + 1))}
                      className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-black disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col md:flex-row gap-3 items-center mt-4">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      value={backorderSearch}
                      onChange={(e) => setBackorderSearch(e.target.value)}
                      placeholder="Cari (backorder)..."
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                    />
                  </div>
                </div>

                <div className="mt-4 max-h-[420px] overflow-y-auto pr-1">
                  {loadingBackorder ? (
                    <div className="flex items-center justify-center p-16 text-slate-400">
                      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : filteredBackorderRows.length === 0 ? (
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                      <AlertTriangle size={18} className="text-amber-500" />
                      Tidak ada data backorder.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-xs text-slate-500">
                          <th className="py-2 w-10">
                            <input
                              ref={backorderMasterCheckboxRef}
                              type="checkbox"
                              checked={filteredBackorderRows.length > 0 && filteredBackorderRows.every((p) => selectedBackorderIds.has(p.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedBackorderIds(new Set(filteredBackorderRows.map((p) => p.id)));
                                else setSelectedBackorderIds(new Set());
                              }}
                            />
                          </th>
                          <th className="py-2">SKU</th>
                          <th className="py-2">Produk</th>
                          <th className="py-2 w-24">Stok</th>
                          <th className="py-2 w-28">Shortage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBackorderRows.map((p) => (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="py-2">
                              <input
                                type="checkbox"
                                checked={selectedBackorderIds.has(p.id)}
                                onChange={(e) => {
                                  setSelectedBackorderIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(p.id);
                                    else next.delete(p.id);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="py-2 font-mono text-xs uppercase tracking-wider text-slate-600">{p.sku}</td>
                            <td className="py-2 font-bold text-slate-900">{p.name}</td>
                            <td className="py-2">{Number(p.stock || 0)}</td>
                            <td className="py-2 font-black text-rose-700">{Number(p.shortage || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            <div className="mt-6 pt-5 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 mb-3">Cari Produk (Tambah Manual)</h3>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Cari SKU / nama produk (min 2 huruf)..."
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                />
              </div>
              <div className="mt-3 max-h-64 overflow-y-auto pr-1 space-y-2">
                {searching ? (
                  <div className="text-sm text-slate-500">Mencari...</div>
                ) : productResults.length === 0 ? (
                  <div className="text-sm text-slate-400">Hasil akan muncul di sini.</div>
                ) : (
                  productResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => upsertItem(p, 1)}
                      className="w-full text-left rounded-2xl border border-slate-200 bg-white p-3 hover:border-emerald-500 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">{p.sku}</div>
                          <div className="font-black text-slate-900 truncate">{p.name}</div>
                        </div>
                        <span className="text-xs font-black text-emerald-700 inline-flex items-center gap-1">
                          <Plus size={14} /> Tambah
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
