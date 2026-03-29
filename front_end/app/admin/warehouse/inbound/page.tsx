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
}

interface CategoryRow {
  id: number;
  name: string;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  stock_quantity: number;
  min_stock?: number;
  base_price: number;
  unit?: string;
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

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function InboundCreatePage() {
  const allowed = useRequireRoles(['super_admin'], '/admin');
  const router = useRouter();

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const [supplierId, setSupplierId] = useState('');

  const [items, setItems] = useState<Array<{ product: ProductRow; qty: number; unit_cost: string; cost_note: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [mode, setMode] = useState<'empty' | 'backorder' | 'manual'>('empty');

  const [emptyPage, setEmptyPage] = useState(1);
  const [emptyLimit, setEmptyLimit] = useState(50);
  const [emptySearch, setEmptySearch] = useState('');
  const [debouncedEmptySearch, setDebouncedEmptySearch] = useState('');
  const [emptyRows, setEmptyRows] = useState<ProductRow[]>([]);
  const [emptyTotalPages, setEmptyTotalPages] = useState(1);
  const [loadingEmpty, setLoadingEmpty] = useState(true);
  const [selectedEmptyIds, setSelectedEmptyIds] = useState<Set<string>>(new Set());
  const emptyMasterCheckboxRef = useRef<HTMLInputElement | null>(null);

  const [backorderRows, setBackorderRows] = useState<BackorderSuggestion[]>([]);
  const [loadingBackorder, setLoadingBackorder] = useState(true);
  const [backorderSearch, setBackorderSearch] = useState('');
  const [selectedBackorderIds, setSelectedBackorderIds] = useState<Set<string>>(new Set());
  const backorderMasterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [addingBackorder, setAddingBackorder] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('Pcs');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newBasePrice, setNewBasePrice] = useState('');
  const [creatingProduct, setCreatingProduct] = useState(false);

  const loadSuppliers = useCallback(async () => {
    try {
      setLoadingSuppliers(true);
      const res = await api.admin.inventory.getSuppliers();
      setSuppliers((res.data?.suppliers || []) as SupplierRow[]);
    } catch {
      setSuppliers([]);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      const res = await api.admin.inventory.getCategories();
      setCategories((res.data?.categories || []) as CategoryRow[]);
    } catch {
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadSuppliers();
    void loadCategories();
  }, [allowed, loadSuppliers, loadCategories]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEmptySearch(emptySearch.trim()), 400);
    return () => clearTimeout(timer);
  }, [emptySearch]);

  useEffect(() => {
    setEmptyPage(1);
  }, [debouncedEmptySearch]);

  const loadEmptyStockSuggestions = useCallback(async () => {
    try {
      setLoadingEmpty(true);
      const res = await api.admin.inventory.getProducts({
        page: emptyPage,
        limit: emptyLimit,
        search: debouncedEmptySearch || undefined,
        status: 'active',
        stock_filter: 'empty',
      });
      const rows = (res.data?.products || []) as ProductRow[];
      setEmptyRows(rows);
      setEmptyTotalPages(Math.max(1, Number(res.data?.totalPages || 1)));
    } catch {
      setEmptyRows([]);
      setEmptyTotalPages(1);
    } finally {
      setLoadingEmpty(false);
    }
  }, [debouncedEmptySearch, emptyLimit, emptyPage]);

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
    void loadEmptyStockSuggestions();
    setSelectedEmptyIds(new Set());
  }, [allowed, loadEmptyStockSuggestions]);

  useEffect(() => {
    if (!allowed) return;
    void loadBackorderSuggestions();
  }, [allowed, loadBackorderSuggestions]);

  useEffect(() => {
    if (!emptyMasterCheckboxRef.current) return;
    const isAll = emptyRows.length > 0 && emptyRows.every((p) => selectedEmptyIds.has(p.id));
    const isSome = emptyRows.some((p) => selectedEmptyIds.has(p.id));
    emptyMasterCheckboxRef.current.indeterminate = isSome && !isAll;
  }, [emptyRows, selectedEmptyIds]);

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

  const doProductSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query || query.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      setSearching(true);
      const res = await api.admin.inventory.getProducts({ limit: 15, search: query, status: 'active' });
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

  const addProductToItems = useCallback((product: ProductRow) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      const basePrice = Number(product.base_price || 0);
      const initialUnitCost = Number.isFinite(basePrice) && basePrice > 0 ? String(basePrice) : '';
      return [...prev, { product, qty: 1, unit_cost: initialUnitCost, cost_note: '' }];
    });
  }, []);

  const upsertProductToItems = useCallback((product: ProductRow, qty: number) => {
    const safeQty = Math.max(1, Number(qty || 1));
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.max(next[idx].qty, safeQty) };
        return next;
      }
      const basePrice = Number(product.base_price || 0);
      const initialUnitCost = Number.isFinite(basePrice) && basePrice > 0 ? String(basePrice) : '';
      return [...prev, { product, qty: safeQty, unit_cost: initialUnitCost, cost_note: '' }];
    });
  }, []);

  useEffect(() => {
    if (mode !== 'manual') setShowCreateProduct(false);
  }, [mode]);

  const removeItem = (productId: string) => setItems((prev) => prev.filter((p) => p.product.id !== productId));

  const addSelectedEmpty = () => {
    const selected = emptyRows.filter((p) => selectedEmptyIds.has(p.id));
    selected.forEach((p) => {
      const suggested = Math.max(1, Number(p.min_stock || 0) - Number(p.stock_quantity || 0));
      upsertProductToItems(p, suggested);
    });
    setSelectedEmptyIds(new Set());
  };

  const addSelectedBackorder = async () => {
    const selected = filteredBackorderRows.filter((p) => selectedBackorderIds.has(p.id));
    if (selected.length === 0) return;
    try {
      setAddingBackorder(true);
      const products = await Promise.all(
        selected.map(async (row) => {
          try {
            const res = await api.admin.inventory.scanBySku(row.sku);
            return res.data as ProductRow;
          } catch {
            return null;
          }
        })
      );
      products.forEach((product, idx) => {
        if (!product) return;
        const row = selected[idx];
        upsertProductToItems(product, row.shortage > 0 ? row.shortage : 1);
      });
      setSelectedBackorderIds(new Set());
    } finally {
      setAddingBackorder(false);
    }
  };

  const payloadItems = useMemo(() => {
    return items.map((it) => {
      const unitCostNum = Number(it.unit_cost);
      return {
        product_id: it.product.id,
        qty: Math.max(1, Number(it.qty || 1)),
        ...(Number.isFinite(unitCostNum) && unitCostNum >= 0 ? { unit_cost: unitCostNum } : {}),
        ...(it.cost_note.trim() ? { cost_note: it.cost_note.trim() } : {}),
      };
    });
  }, [items]);

  const createInbound = async () => {
    if (!supplierId) {
      setErrorMessage('Supplier wajib dipilih.');
      return;
    }
    if (items.length === 0) {
      setErrorMessage('Masukkan minimal satu barang.');
      return;
    }
    const missingCost = items.find((it) => {
      const expected = Number(it.product.base_price || 0);
      const unitCostNum = Number(it.unit_cost);
      const hasActual = it.unit_cost.trim().length > 0 && Number.isFinite(unitCostNum) && unitCostNum > 0;
      const hasExpected = Number.isFinite(expected) && expected > 0;
      return !hasActual && !hasExpected;
    });
    if (missingCost) {
      setErrorMessage(`Modal belum terisi untuk SKU ${missingCost.product.sku}. Isi Unit Cost atau lengkapi Base Price di master produk.`);
      return;
    }
    const invalidReason = items.find((it) => {
      const expected = Number(it.product.base_price || 0);
      const unitCostNum = Number(it.unit_cost);
      const hasActual = it.unit_cost.trim().length > 0 && Number.isFinite(unitCostNum) && unitCostNum >= 0;
      if (!hasActual) return false;
      const expected2 = Math.round(expected * 100) / 100;
      const actual2 = Math.round(unitCostNum * 100) / 100;
      return expected2 !== actual2 && !it.cost_note.trim();
    });
    if (invalidReason) {
      setErrorMessage(`Alasan selisih harga wajib diisi untuk SKU ${invalidReason.product.sku}.`);
      return;
    }

    try {
      setSaving(true);
      setErrorMessage('');
      const res = await api.admin.inventory.createInbound({
        supplier_id: Number(supplierId),
        items: payloadItems,
      });
      const id = String(res.data?.id || '');
      if (id) router.push(`/admin/warehouse/inbound/${id}`);
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setErrorMessage(err?.response?.data?.message || 'Gagal membuat draft inbound.');
    } finally {
      setSaving(false);
    }
  };

  const createProduct = async () => {
    const sku = newSku.trim();
    const name = newName.trim();
    const unit = newUnit.trim() || 'Pcs';
    const categoryId = Number(newCategoryId);
    if (!sku || !name || !Number.isInteger(categoryId) || categoryId <= 0) {
      setErrorMessage('Isi SKU, Nama, dan Kategori.');
      return;
    }
    try {
      setCreatingProduct(true);
      setErrorMessage('');
      const basePrice = Number(newBasePrice);
      const res = await api.admin.inventory.createProduct({
        sku,
        name,
        unit,
        category_id: categoryId,
        ...(Number.isFinite(basePrice) && basePrice >= 0 ? { base_price: basePrice, price: basePrice } : {}),
      });
      const product = res.data as ProductRow;
      addProductToItems(product);
      setShowCreateProduct(false);
      setNewSku('');
      setNewName('');
      setNewUnit('Pcs');
      setNewBasePrice('');
      setNewCategoryId('');
    } catch (error: unknown) {
      const err = error as ApiErrorWithMessage;
      setErrorMessage(err?.response?.data?.message || 'Gagal menambahkan produk baru.');
    } finally {
      setCreatingProduct(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="warehouse-title !mb-1 flex items-center gap-2">
            <Package className="text-emerald-600" />
            Inbound Gudang
          </h1>
          <p className="warehouse-subtitle !mb-0">
            Input barang fisik yang sudah datang, lalu verifikasi 2 langkah sebelum stok diposting.
          </p>
        </div>
        <Link
          href="/admin/warehouse/inbound/history"
          className="rounded-2xl bg-white border border-slate-200 text-slate-600 text-sm font-black px-6 py-3 inline-flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
        >
          <HistoryIcon size={18} />
          Riwayat Inbound
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
                <p className="text-sm text-center px-4">Belum ada barang dipilih. Cari di panel kanan.</p>
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
                          Stok DB: <span className="font-bold">{Number(it.product.stock_quantity || 0)}</span>
                        </div>
                      </div>
                      <button onClick={() => removeItem(it.product.id)} className="text-rose-500 hover:underline text-xs font-bold">
                        Hapus
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty Datang</label>
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
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Unit Cost (Opsional)</label>
                        <input
                          value={it.unit_cost}
                          onChange={(e) => setItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, unit_cost: e.target.value } : p))}
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder={Number(it.product.base_price || 0) > 0 ? `default: ${Number(it.product.base_price || 0)}` : 'wajib diisi (base price kosong)'}
                        />
                      </div>
                    </div>

                    {(() => {
                      const expected = Number(it.product.base_price || 0);
                      const unitCostNum = Number(it.unit_cost);
                      const hasActual = it.unit_cost.trim().length > 0 && Number.isFinite(unitCostNum) && unitCostNum >= 0;
                      const expected2 = Math.round(expected * 100) / 100;
                      const actual2 = hasActual ? Math.round(unitCostNum * 100) / 100 : expected2;
                      const diff = Math.round((actual2 - expected2) * 100) / 100;
                      const isDifferent = hasActual && expected2 !== actual2;
                      return (
                        <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Modal DB (Expected)</div>
                              <div className="font-black text-slate-700">Rp {expected2.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Actual</div>
                              <div className="font-black text-slate-700">Rp {actual2.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Selisih</div>
                              <div className={`font-black ${diff < 0 ? 'text-emerald-700' : diff > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                                Rp {diff.toLocaleString()}
                              </div>
                            </div>
                          </div>

                          {isDifferent && (
                            <div className="mt-3">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Alasan Selisih (Wajib)</label>
                              <textarea
                                value={it.cost_note}
                                onChange={(e) => setItems((prev) => prev.map((p) => p.product.id === it.product.id ? { ...p, cost_note: e.target.value } : p))}
                                rows={2}
                                className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                placeholder="contoh: cuci gudang / beli dari orang lain / promo"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={createInbound}
              disabled={saving}
              className="mt-4 rounded-2xl bg-slate-900 text-white text-sm font-black px-6 py-3.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Save size={18} />
              )}
              Simpan Draft Inbound
            </button>

            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              Draft belum menambah stok sampai verifikasi langkah 2.
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 min-h-0 order-1 lg:order-2 flex flex-col gap-4">
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 p-1">
                <button
                  onClick={() => setMode('empty')}
                  className={`px-4 py-2 rounded-2xl text-sm font-black transition-all ${mode === 'empty' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-600'}`}
                >
                  Produk Habis
                </button>
                <button
                  onClick={() => setMode('backorder')}
                  className={`px-4 py-2 rounded-2xl text-sm font-black transition-all ${mode === 'backorder' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-600'}`}
                >
                  Backorder
                </button>
                <button
                  onClick={() => setMode('manual')}
                  className={`px-4 py-2 rounded-2xl text-sm font-black transition-all ${mode === 'manual' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-600'}`}
                >
                  Input Manual
                </button>
              </div>
              {mode === 'empty' ? (
                <button
                  onClick={addSelectedEmpty}
                  disabled={selectedEmptyIds.size === 0}
                  className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-40 hover:bg-emerald-700 transition-all"
                >
                  <Plus size={18} />
                  Tambah ({selectedEmptyIds.size})
                </button>
              ) : mode === 'backorder' ? (
                <button
                  onClick={() => void addSelectedBackorder()}
                  disabled={addingBackorder || selectedBackorderIds.size === 0}
                  className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-40 hover:bg-emerald-700 transition-all"
                >
                  {addingBackorder ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Plus size={18} />
                  )}
                  Tambah ({selectedBackorderIds.size})
                </button>
              ) : (
                <button
                  onClick={() => setShowCreateProduct((v) => !v)}
                  className="rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 hover:bg-slate-50 transition-all"
                >
                  <Plus size={18} />
                  Tambah Produk Baru
                </button>
              )}
            </div>

            {mode === 'empty' ? (
              <>
                <div className="flex flex-col md:flex-row gap-3 items-center mt-4">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      value={emptySearch}
                      onChange={(e) => setEmptySearch(e.target.value)}
                      placeholder="Cari (produk habis)..."
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                    />
                  </div>
                  <select
                    value={emptyLimit}
                    onChange={(e) => setEmptyLimit(Number(e.target.value))}
                    className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <div className="mt-4 max-h-[520px] overflow-y-auto pr-1">
                  {loadingEmpty ? (
                    <div className="flex items-center justify-center p-16 text-slate-400">
                      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : emptyRows.length === 0 ? (
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                      <AlertTriangle size={18} className="text-amber-500" />
                      Tidak ada produk habis.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-xs text-slate-500">
                          <th className="py-2 w-10">
                            <input
                              ref={emptyMasterCheckboxRef}
                              type="checkbox"
                              checked={emptyRows.length > 0 && emptyRows.every((p) => selectedEmptyIds.has(p.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedEmptyIds(new Set(emptyRows.map((p) => p.id)));
                                else setSelectedEmptyIds(new Set());
                              }}
                            />
                          </th>
                          <th className="py-2">SKU</th>
                          <th className="py-2">Produk</th>
                          <th className="py-2 w-20">Stok</th>
                          <th className="py-2 w-20">Min</th>
                          <th className="py-2 w-24">Saran</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emptyRows.map((p) => {
                          const suggested = Math.max(1, Number(p.min_stock || 0) - Number(p.stock_quantity || 0));
                          return (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedEmptyIds.has(p.id)}
                                  onChange={(e) => {
                                    setSelectedEmptyIds((prev) => {
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

                {emptyTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <button
                      disabled={emptyPage === 1}
                      onClick={() => setEmptyPage((p) => Math.max(1, p - 1))}
                      className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-black disabled:opacity-30"
                    >
                      Prev
                    </button>
                    <div className="text-sm text-slate-600 font-bold">Halaman {emptyPage} / {emptyTotalPages}</div>
                    <button
                      disabled={emptyPage === emptyTotalPages}
                      onClick={() => setEmptyPage((p) => Math.min(emptyTotalPages, p + 1))}
                      className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-black disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : mode === 'backorder' ? (
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

                <div className="mt-4 max-h-[520px] overflow-y-auto pr-1">
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
                          <th className="py-2 w-20">Stok</th>
                          <th className="py-2 w-24">Shortage</th>
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
            ) : (
              <>
                {showCreateProduct && (
                  <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">SKU</label>
                        <input value={newSku} onChange={(e) => setNewSku(e.target.value)} className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Nama</label>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Unit</label>
                        <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Kategori</label>
                        <select
                          value={newCategoryId}
                          onChange={(e) => setNewCategoryId(e.target.value)}
                          disabled={loadingCategories}
                          className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="">Pilih kategori...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Base Price (opsional)</label>
                        <input value={newBasePrice} onChange={(e) => setNewBasePrice(e.target.value)} className="w-full mt-1 bg-white border border-slate-200 rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="contoh: 15000" />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={createProduct}
                        disabled={creatingProduct}
                        className="rounded-2xl bg-emerald-600 text-white text-sm font-black px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-all"
                      >
                        {creatingProduct ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Plus size={18} />
                        )}
                        Simpan Produk
                      </button>
                      <button
                        onClick={() => setShowCreateProduct(false)}
                        className="rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-black px-4 py-2.5 hover:bg-slate-50 transition-all"
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-500 uppercase tracking-widest">Search SKU</div>
                  <div className="mt-2 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Cari SKU / barcode / nama produk (min 2 huruf)..."
                      className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm font-medium"
                      inputMode="search"
                      autoComplete="off"
                    />
                  </div>

                  <div className="mt-3 max-h-[520px] overflow-y-auto pr-1 space-y-2">
                    {searching ? (
                      <div className="text-sm text-slate-500">Mencari...</div>
                    ) : productResults.length === 0 ? (
                      <div className="text-sm text-slate-400">Hasil akan muncul di sini.</div>
                    ) : (
                      productResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addProductToItems(p)}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
