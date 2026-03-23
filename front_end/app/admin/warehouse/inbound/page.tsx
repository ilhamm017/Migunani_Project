'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { Search, Plus, Trash2, Save, Package, AlertTriangle, ShoppingBag, RefreshCw, History as HistoryIcon } from 'lucide-react';

interface SupplierRow {
  id: number;
  name: string;
  contact: string | null;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  stock_quantity: number;
  min_stock?: number;
  base_price: number;
}

interface POItem {
  product: Product;
  qty: number;
  unit_cost: number;
}

interface BackorderSuggestion {
  id: string;
  name: string;
  sku: string;
  stock: number;
  shortage: number;
  shortage_unallocated?: number;
  shortage_confirmed?: number;
  base_price: number;
}

interface BackorderItemRow {
  product_id: string;
  product_name: string;
  sku: string;
  stock_quantity: number;
  shortage_qty: number;
  base_price: number;
}

interface BackorderOrderRow {
  shortage_items?: BackorderItemRow[];
  status_label?: 'fulfilled' | 'backorder' | 'preorder' | 'unallocated' | string;
  has_active_backorder_record?: boolean;
}

interface CreatePOResult {
  id?: string;
  status?: string;
}

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function PurchaseOrderPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir'], '/admin');

  // Form State
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState<POItem[]>([]);

  // Data State
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [restockSuggestions, setRestockSuggestions] = useState<Product[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [restockTotal, setRestockTotal] = useState(0);
  const [restockTotalPages, setRestockTotalPages] = useState(1);
  const [restockPage, setRestockPage] = useState(1);
  const [restockLimit, setRestockLimit] = useState(50);
  const [restockSearch, setRestockSearch] = useState('');
  const [debouncedRestockSearch, setDebouncedRestockSearch] = useState('');
  const [selectedRestockIds, setSelectedRestockIds] = useState<Set<string>>(new Set());
  const restockMasterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [backorderSuggestions, setBackorderSuggestions] = useState<BackorderSuggestion[]>([]);
  const [loadingBackorderSuggestions, setLoadingBackorderSuggestions] = useState(true);
  const [selectedBackorderIds, setSelectedBackorderIds] = useState<Set<string>>(new Set());
  const [backorderSearch, setBackorderSearch] = useState('');
  const backorderMasterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [backorderOrderLabelCounts, setBackorderOrderLabelCounts] = useState<Record<string, number>>({});

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  // UI State
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreatePOResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const loadRestockSuggestions = useCallback(async () => {
    try {
      setLoadingSuggestions(true);
      const res = await api.admin.inventory.getRestockSuggestions({
        page: restockPage,
        limit: restockLimit,
        search: debouncedRestockSearch || undefined,
        status: 'active'
      });
      setRestockSuggestions(res.data?.products || []);
      setRestockTotal(Number(res.data?.total || 0));
      setRestockTotalPages(Math.max(1, Number(res.data?.totalPages || 1)));
    } catch (error) {
      console.error('Failed to load restock suggestions', error);
      setRestockSuggestions([]);
      setRestockTotal(0);
      setRestockTotalPages(1);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [debouncedRestockSearch, restockLimit, restockPage]);

  // Initial Load
  useEffect(() => {
    if (allowed) {
      loadSuppliers();
      loadBackorderSuggestions();
    }
  }, [allowed]);

  // Restock suggestions: debounce + paging
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRestockSearch(restockSearch.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [restockSearch]);

  useEffect(() => {
    if (!allowed) return;
    loadRestockSuggestions();
    // keep checklist page-local to avoid hidden selections
    setSelectedRestockIds(new Set());
  }, [allowed, loadRestockSuggestions]);

  // Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadSuppliers = async () => {
    try {
      setLoadingSuppliers(true);
      const res = await api.admin.inventory.getSuppliers();
      setSuppliers(res.data?.suppliers || []);
    } catch (error) {
      console.error(error);
      setErrorMessage('Gagal memuat daftar supplier.');
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const loadBackorderSuggestions = async () => {
    try {
      setLoadingBackorderSuggestions(true);
      const res = await api.allocation.getPending({ scope: 'shortage' });
      const rows = (res.data?.rows || []) as BackorderOrderRow[];

      // Aggregate shortages by product
      const aggregated = new Map<string, BackorderSuggestion>();
      const labelCounts: Record<string, number> = {};

      rows.forEach((order) => {
        const label = String(order?.status_label || 'unallocated');
        labelCounts[label] = Number(labelCounts[label] || 0) + 1;

        (order.shortage_items || []).forEach((item) => {
          const productId = item.product_id;
          const existing = aggregated.get(productId);
          const shortageQty = Number(item.shortage_qty || 0);
          const isUnallocated = label === 'unallocated';
          if (existing) {
            existing.shortage += shortageQty;
            if (isUnallocated) existing.shortage_unallocated = Number(existing.shortage_unallocated || 0) + shortageQty;
            else existing.shortage_confirmed = Number(existing.shortage_confirmed || 0) + shortageQty;
          } else {
            aggregated.set(productId, {
              id: productId,
              name: item.product_name,
              sku: item.sku,
              stock: Number(item.stock_quantity || 0),
              shortage: shortageQty,
              shortage_unallocated: isUnallocated ? shortageQty : 0,
              shortage_confirmed: isUnallocated ? 0 : shortageQty,
              base_price: Number(item.base_price || 0),
            });
          }
        });
      });

      setBackorderSuggestions(
        Array.from(aggregated.values()).sort((a, b) => {
          if (b.shortage !== a.shortage) return b.shortage - a.shortage;
          if (a.stock !== b.stock) return a.stock - b.stock;
          return a.name.localeCompare(b.name);
        })
      );
      setBackorderOrderLabelCounts(labelCounts);
      setSelectedBackorderIds(new Set());
    } catch (error) {
      console.error('Failed to load backorder suggestions', error);
      setBackorderSuggestions([]);
      setBackorderOrderLabelCounts({});
    } finally {
      setLoadingBackorderSuggestions(false);
    }
  };

  const performSearch = async (query: string) => {
    try {
      setSearching(true);
      const res = await api.admin.inventory.getProducts({ search: query, limit: 10 });
      setSearchResults(res.data?.products || []);
    } catch (error) {
      console.error(error);
    } finally {
      setSearching(false);
    }
  };

  const addItem = (product: Product) => {
    setItems(prev => {
      if (prev.find(item => item.product.id === product.id)) return prev;
      return [...prev, {
        product,
        qty: 1,
        unit_cost: Number(product.base_price || 0)
      }];
    });
    setSearchQuery(''); // Clear search after adding
    setSearchResults([]);
  };

  const getSuggestedRestockQty = (product: Product) => {
    const stock = Number(product.stock_quantity || 0);
    const minStock = Number(product.min_stock || 0);
    return Math.max(1, (Math.max(minStock, 1) * 2) - stock);
  };

  const upsertDraftItems = (
    draftItems: Array<{ product: Product; qty: number; unit_cost: number; mode: 'max' | 'add' }>
  ) => {
    setItems(prev => {
      const next = [...prev];

      draftItems.forEach(({ product, qty, unit_cost, mode }) => {
        const existingIndex = next.findIndex(p => p.product.id === product.id);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            qty: mode === 'add' ? (existing.qty + qty) : Math.max(existing.qty, qty),
          };
          return;
        }

        next.push({
          product,
          qty,
          unit_cost
        });
      });

      return next;
    });
  };

  const addSuggestedItem = (product: Product) => {
    const defaultQty = getSuggestedRestockQty(product);
    upsertDraftItems([{
      product,
      qty: defaultQty,
      unit_cost: Number(product.base_price || 0),
      mode: 'max'
    }]);
  };

  const updateItem = (index: number, field: 'qty' | 'unit_cost', value: number) => {
    setItems(prev => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };
      return newItems;
    });
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalCost = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.qty * item.unit_cost), 0);
  }, [items]);

  const filteredBackorderSuggestions = useMemo(() => {
    const q = backorderSearch.trim().toLowerCase();
    if (!q) return backorderSuggestions;
    return backorderSuggestions.filter(item =>
      item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)
    );
  }, [backorderSuggestions, backorderSearch]);

  const isAllRestockSelectedOnPage = useMemo(() => {
    if (restockSuggestions.length === 0) return false;
    return restockSuggestions.every(p => selectedRestockIds.has(p.id));
  }, [restockSuggestions, selectedRestockIds]);

  const isSomeRestockSelectedOnPage = useMemo(() => {
    return restockSuggestions.some(p => selectedRestockIds.has(p.id)) && !isAllRestockSelectedOnPage;
  }, [restockSuggestions, selectedRestockIds, isAllRestockSelectedOnPage]);

  useEffect(() => {
    if (!restockMasterCheckboxRef.current) return;
    restockMasterCheckboxRef.current.indeterminate = isSomeRestockSelectedOnPage;
  }, [isSomeRestockSelectedOnPage]);

  const isAllBackorderSelectedOnPage = useMemo(() => {
    if (filteredBackorderSuggestions.length === 0) return false;
    return filteredBackorderSuggestions.every(p => selectedBackorderIds.has(p.id));
  }, [filteredBackorderSuggestions, selectedBackorderIds]);

  const isSomeBackorderSelectedOnPage = useMemo(() => {
    return filteredBackorderSuggestions.some(p => selectedBackorderIds.has(p.id)) && !isAllBackorderSelectedOnPage;
  }, [filteredBackorderSuggestions, selectedBackorderIds, isAllBackorderSelectedOnPage]);

  useEffect(() => {
    if (!backorderMasterCheckboxRef.current) return;
    backorderMasterCheckboxRef.current.indeterminate = isSomeBackorderSelectedOnPage;
  }, [isSomeBackorderSelectedOnPage]);

  const createPO = async () => {
    if (!supplierId) {
      setErrorMessage('Pilih supplier terlebih dahulu.');
      return;
    }
    if (items.length === 0) {
      setErrorMessage('Masukkan minimal satu barang.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');
      const payload = {
        supplier_id: Number(supplierId),
        total_cost: totalCost,
        items: items.map(item => ({
          product_id: item.product.id,
          qty: item.qty,
          unit_cost: item.unit_cost
        }))
      };

      const res = await api.admin.inventory.createPO(payload);
      setResult(res.data);

      // Reset form
      setSupplierId('');
      setItems([]);
    } catch (error: unknown) {
      console.error('Create PO failed:', error);
      const err = error as ApiErrorWithMessage;
      setErrorMessage(err?.response?.data?.message || 'Gagal membuat purchase order.');
    } finally {
      setLoading(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="warehouse-page w-full max-w-none lg:h-full lg:overflow-hidden overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="warehouse-title !mb-1 flex items-center gap-2">
            <Package className="text-emerald-600" />
            Inbound / Purchase Order
          </h1>
          <p className="warehouse-subtitle !mb-0">Buat pesanan pengadaan barang ke supplier untuk menambah stok gudang.</p>
        </div>
        <Link
          href="/admin/warehouse/inbound/history"
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

      {result && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 shrink-0">
          <p className="text-sm font-bold text-emerald-700">✅ PO Berhasil Dibuat</p>
          <div className="text-xs text-emerald-600 mt-1 flex gap-4">
            <span>ID: <span className="font-mono">{result.id}</span></span>
            <span>Status: <span className="uppercase">{result.status}</span></span>
            <span>Total: <span className="font-bold">Rp {totalCost.toLocaleString()}</span></span>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Left Column (Mobile: Second / Desktop: First sidebar) */}
        <div className="lg:col-span-1 min-h-0 order-2 lg:order-1">
          {/* Added Items List */}
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm h-full flex flex-col">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center justify-between">
              <span>Daftar Barang ({items.length})</span>
              {items.length > 0 && (
                <button onClick={() => setItems([])} className="text-xs text-rose-500 font-medium hover:underline">Hapus Semua</button>
              )}
            </h3>

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-44 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                <Package size={48} className="mb-2 opacity-20" />
                <p className="text-sm text-center px-4">Belum ada barang dipilih. Cari barang di panel kanan atau pilih saran.</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {items.map((item, index) => (
                  <div key={`${item.product.id}-${index}`} className="flex flex-col gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                    <div className="flex-1">
                      <div className="font-bold text-slate-900 text-sm">{item.product.name}</div>
                      <div className="text-xs text-slate-500">SKU: {item.product.sku}</div>
                    </div>

                    <div className="flex items-center gap-3 w-full">
                      <div className="flex-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(e) => updateItem(index, 'qty', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="flex-[2]">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Harga Beli (@)</label>
                        <input
                          type="number"
                          min="0"
                          value={item.unit_cost}
                          onChange={(e) => updateItem(index, 'unit_cost', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="w-8 flex justify-end pt-5">
                        <button
                          onClick={() => removeItem(index)}
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center text-sm shrink-0">
                <span className="text-slate-500 font-medium">Subtotal Item</span>
                <span className="font-bold text-slate-900">Rp {totalCost.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Mobile: First / Desktop: Main area) */}
        <div className="lg:col-span-2 flex flex-col gap-4 min-h-0 order-1 lg:order-2">
          {/* Product Search (Top priority on both mobile and desktop) */}
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm shrink-0">
            <h3 className="font-bold text-slate-900 mb-4">Cari Barang</h3>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ketik nama barang atau SKU..."
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
              />
              {searching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="w-5 h-5 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <div className="mt-2 text-sm text-slate-500 text-center py-2">Barang tidak ditemukan.</div>
            )}

            {searchResults.length > 0 && (
              <div className="mt-4 border border-slate-100 rounded-2xl overflow-hidden max-h-60 overflow-y-auto shadow-sm">
                {searchResults.map(product => (
                  <button
                    key={product.id}
                    onClick={() => addItem(product)}
                    className="w-full text-left p-3 hover:bg-emerald-50 border-b border-slate-50 last:border-0 flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-sm group-hover:text-emerald-700">{product.name}</div>
                      <div className="text-xs text-slate-500">SKU: {product.sku} • Stok: {product.stock_quantity}</div>
                    </div>
                    <div className="bg-slate-100 p-2 rounded-lg group-hover:bg-emerald-200 transition-colors">
                      <Plus size={16} className="text-slate-600 group-hover:text-emerald-800" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Suggestions Layer (Horizontal on desktop, vertical stack on mobile) */}
          <div className="grid grid-cols-1 gap-4 flex-1 min-h-0 lg:overflow-y-auto lg:pr-2">
            {/* Restock Suggestions */}
            <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm min-h-0 flex flex-col">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-600" />
                    Saran Barang Menipis / Habis
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Prioritas barang yang perlu dipertimbangkan untuk PO berikutnya.</p>
                </div>
                <button
                  onClick={loadRestockSuggestions}
                  disabled={loadingSuggestions}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  {loadingSuggestions ? 'Memuat...' : 'Refresh'}
                </button>
              </div>

              {loadingSuggestions ? (
                <div className="text-sm text-slate-500 py-6 text-center">Memuat saran restock...</div>
              ) : restockSuggestions.length === 0 ? (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                  Semua stok produk saat ini dalam kondisi aman.
                </div>
              ) : (
                <div className="flex flex-col gap-3 flex-1 min-h-0">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="md:col-span-2">
                      <input
                        value={restockSearch}
                        onChange={(e) => {
                          setRestockSearch(e.target.value);
                          setRestockPage(1);
                        }}
                        placeholder="Filter nama / SKU / barcode..."
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-center gap-2">
                      <select
                        value={restockLimit}
                        onChange={(e) => {
                          setRestockLimit(Number(e.target.value) || 50);
                          setRestockPage(1);
                        }}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value={25}>25 / halaman</option>
                        <option value={50}>50 / halaman</option>
                        <option value={100}>100 / halaman</option>
                        <option value={200}>200 / halaman</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      Total: <span className="font-bold text-slate-700">{restockTotal.toLocaleString()}</span> item
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const selected = restockSuggestions.filter(p => selectedRestockIds.has(p.id));
                          selected.forEach(addSuggestedItem);
                          setSelectedRestockIds(new Set());
                        }}
                        disabled={selectedRestockIds.size === 0}
                        className="text-xs font-bold px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:hover:bg-emerald-50 transition-colors"
                      >
                        Tambah Terpilih ({selectedRestockIds.size})
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 border border-slate-100 rounded-2xl overflow-hidden">
                    <div className="h-full overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-white border-b border-slate-100">
                          <tr className="text-xs text-slate-500">
                            <th className="px-3 py-2 w-10">
                              <input
                                ref={restockMasterCheckboxRef}
                                type="checkbox"
                                checked={isAllRestockSelectedOnPage}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRestockIds(new Set(restockSuggestions.map(p => p.id)));
                                  } else {
                                    setSelectedRestockIds(new Set());
                                  }
                                }}
                                className="h-4 w-4 accent-emerald-600"
                              />
                            </th>
                            <th className="px-3 py-2 text-left font-bold">Nama</th>
                            <th className="px-3 py-2 text-left font-bold">SKU</th>
                            <th className="px-3 py-2 text-right font-bold">Stok</th>
                            <th className="px-3 py-2 text-right font-bold">Min</th>
                            <th className="px-3 py-2 text-left font-bold">Status</th>
                            <th className="px-3 py-2 text-right font-bold">Saran Qty</th>
                            <th className="px-3 py-2 text-right font-bold">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {restockSuggestions.map((product) => {
                            const stock = Number(product.stock_quantity || 0);
                            const minStock = Number(product.min_stock || 0);
                            const critical = stock <= 0;
                            const alreadyInDraft = items.some(item => item.product.id === product.id);
                            const suggestedQty = getSuggestedRestockQty(product);
                            const checked = selectedRestockIds.has(product.id);

                            return (
                              <tr key={product.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 align-middle">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setSelectedRestockIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(product.id)) next.delete(product.id);
                                        else next.add(product.id);
                                        return next;
                                      });
                                    }}
                                    className="h-4 w-4 accent-emerald-600"
                                  />
                                </td>
                                <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                                  <div className="max-w-[360px] truncate">{product.name}</div>
                                </td>
                                <td className="px-3 py-2 text-slate-600 font-mono text-xs whitespace-nowrap">{product.sku}</td>
                                <td className="px-3 py-2 text-right font-bold text-slate-900 whitespace-nowrap">{stock}</td>
                                <td className="px-3 py-2 text-right font-bold text-slate-700 whitespace-nowrap">{minStock}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span
                                    className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider ${critical
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-amber-100 text-amber-700'
                                      }`}
                                  >
                                    {critical ? 'Habis' : 'Menipis'}
                                  </span>
                                  {alreadyInDraft && (
                                    <span className="ml-2 text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider bg-slate-100 text-slate-600">
                                      Draft
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-slate-900 whitespace-nowrap">{suggestedQty}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => addSuggestedItem(product)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${alreadyInDraft
                                      ? 'bg-slate-200 text-slate-600 border-slate-300'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      }`}
                                  >
                                    {alreadyInDraft ? 'Sudah' : 'Tambah'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <div>
                      Halaman <span className="font-bold text-slate-700">{restockPage}</span> / <span className="font-bold text-slate-700">{restockTotalPages}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRestockPage(p => Math.max(1, p - 1))}
                        disabled={restockPage <= 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setRestockPage(p => Math.min(restockTotalPages, p + 1))}
                        disabled={restockPage >= restockTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Backorder Suggestions */}
            <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm min-h-0 flex flex-col">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <ShoppingBag size={16} className="text-emerald-600" />
                    Saran Backorder / PO
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Barang yang kurang untuk memenuhi pesanan.</p>
                </div>
                <button
                  onClick={loadBackorderSuggestions}
                  disabled={loadingBackorderSuggestions}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {loadingBackorderSuggestions ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  <span>Refresh</span>
                </button>
              </div>

              {loadingBackorderSuggestions ? (
                <div className="text-sm text-slate-500 py-6 text-center">Memuat saran backorder...</div>
              ) : backorderSuggestions.length === 0 ? (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                  Tidak ada barang backorder saat ini.
                </div>
              ) : (
                <div className="flex flex-col gap-3 flex-1 min-h-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                      Unallocated: {Number(backorderOrderLabelCounts.unallocated || 0)}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-purple-100 text-purple-700">
                      Preorder: {Number(backorderOrderLabelCounts.preorder || 0)}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                      Backorder: {Number(backorderOrderLabelCounts.backorder || 0)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="md:col-span-2">
                      <input
                        value={backorderSearch}
                        onChange={(e) => setBackorderSearch(e.target.value)}
                        placeholder="Filter nama / SKU..."
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-center gap-2">
                      <button
                        onClick={() => {
                          const selected = filteredBackorderSuggestions.filter(p => selectedBackorderIds.has(p.id));
                          upsertDraftItems(
                            selected.map((it) => ({
                              product: {
                                id: it.id,
                                name: it.name,
                                sku: it.sku,
                                stock_quantity: it.stock,
                                base_price: it.base_price
                              },
                              qty: it.shortage,
                              unit_cost: it.base_price,
                              mode: 'add'
                            }))
                          );
                          setSelectedBackorderIds(new Set());
                        }}
                        disabled={selectedBackorderIds.size === 0}
                        className="w-full text-xs font-bold px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:hover:bg-emerald-50 transition-colors"
                      >
                        Tambah Terpilih ({selectedBackorderIds.size})
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 border border-slate-100 rounded-2xl overflow-hidden">
                    <div className="h-full overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-white border-b border-slate-100">
                          <tr className="text-xs text-slate-500">
                            <th className="px-3 py-2 w-10">
                              <input
                                ref={backorderMasterCheckboxRef}
                                type="checkbox"
                                checked={isAllBackorderSelectedOnPage}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedBackorderIds(new Set(filteredBackorderSuggestions.map(p => p.id)));
                                  } else {
                                    setSelectedBackorderIds(new Set());
                                  }
                                }}
                                className="h-4 w-4 accent-emerald-600"
                              />
                            </th>
                            <th className="px-3 py-2 text-left font-bold">Nama</th>
                            <th className="px-3 py-2 text-left font-bold">SKU</th>
                            <th className="px-3 py-2 text-right font-bold">Stok</th>
                            <th className="px-3 py-2 text-right font-bold">Butuh</th>
                            <th className="px-3 py-2 text-right font-bold">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filteredBackorderSuggestions.map((it) => {
                            const alreadyInDraft = items.some(draftItem => draftItem.product.id === it.id);
                            const checked = selectedBackorderIds.has(it.id);

                            return (
                              <tr key={it.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 align-middle">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setSelectedBackorderIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(it.id)) next.delete(it.id);
                                        else next.add(it.id);
                                        return next;
                                      });
                                    }}
                                    className="h-4 w-4 accent-emerald-600"
                                  />
                                </td>
                                <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                                  <div className="max-w-[360px] truncate">{it.name}</div>
                                  {alreadyInDraft && (
                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mt-0.5">Draft</div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-600 font-mono text-xs whitespace-nowrap">{it.sku}</td>
                                <td className="px-3 py-2 text-right font-bold text-slate-900 whitespace-nowrap">{it.stock}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  <div className="font-black text-rose-700">{it.shortage}</div>
                                  {(Number(it.shortage_unallocated || 0) > 0 || Number(it.shortage_confirmed || 0) > 0) && (
                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-0.5">
                                      {Number(it.shortage_unallocated || 0) > 0 ? `Unalloc ${Number(it.shortage_unallocated || 0)}` : null}
                                      {Number(it.shortage_unallocated || 0) > 0 && Number(it.shortage_confirmed || 0) > 0 ? ' • ' : null}
                                      {Number(it.shortage_confirmed || 0) > 0 ? `Confirmed ${Number(it.shortage_confirmed || 0)}` : null}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => {
                                      upsertDraftItems([{
                                        product: {
                                          id: it.id,
                                          name: it.name,
                                          sku: it.sku,
                                          stock_quantity: it.stock,
                                          base_price: it.base_price
                                        },
                                        qty: it.shortage,
                                        unit_cost: it.base_price,
                                        mode: 'add'
                                      }]);
                                    }}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${alreadyInDraft
                                      ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      }`}
                                  >
                                    {alreadyInDraft ? `Tambah (+${it.shortage})` : 'Tambah'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Information Supplier Card moved to main area */}
          <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm xl:col-span-2">
            <h3 className="font-bold text-slate-900 mb-4">Informasi Supplier & Finalisasi PO</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  disabled={loadingSuppliers}
                >
                  <option value="">{loadingSuppliers ? 'Memuat...' : 'Pilih Supplier...'}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-center">
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Total Estimasi Biaya</div>
                <div className="text-xl font-black text-slate-900">
                  Rp {totalCost.toLocaleString()}
                </div>
              </div>

              <div className="md:col-span-1 flex items-end">
                <button
                  onClick={createPO}
                  disabled={loading || items.length === 0 || !supplierId}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                >
                  {loading ? 'Menyimpan...' : (
                    <>
                      <Save size={18} />
                      Buat Purchase Order
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
