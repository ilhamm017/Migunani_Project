'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
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
  base_price: number;
}

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
  const [backorderSuggestions, setBackorderSuggestions] = useState<BackorderSuggestion[]>([]);
  const [loadingBackorderSuggestions, setLoadingBackorderSuggestions] = useState(true);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  // UI State
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Initial Load
  useEffect(() => {
    if (allowed) {
      loadSuppliers();
      loadRestockSuggestions();
      loadBackorderSuggestions();
    }
  }, [allowed]);

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

  const loadRestockSuggestions = async () => {
    try {
      setLoadingSuggestions(true);
      const res = await api.admin.inventory.getProducts({ limit: 500, status: 'active' });
      const rows = Array.isArray(res.data?.products) ? res.data.products : [];

      const suggested = rows
        .filter((product: any) => {
          const stock = Number(product?.stock_quantity || 0);
          const minStock = Number(product?.min_stock || 0);
          return stock <= 0 || stock <= minStock;
        })
        .sort((a: any, b: any) => {
          const aStock = Number(a?.stock_quantity || 0);
          const bStock = Number(b?.stock_quantity || 0);
          const aMin = Number(a?.min_stock || 0);
          const bMin = Number(b?.min_stock || 0);

          const aCritical = aStock <= 0 ? 1 : 0;
          const bCritical = bStock <= 0 ? 1 : 0;
          if (aCritical !== bCritical) return bCritical - aCritical;

          const aGap = aMin - aStock;
          const bGap = bMin - bStock;
          return bGap - aGap;
        })
        .slice(0, 8);

      setRestockSuggestions(suggested);
    } catch (error) {
      console.error('Failed to load restock suggestions', error);
      setRestockSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const loadBackorderSuggestions = async () => {
    try {
      setLoadingBackorderSuggestions(true);
      const res = await api.allocation.getPending({ scope: 'shortage' });
      const rows = res.data?.rows || [];

      // Aggregate shortages by product
      const aggregated = new Map<string, BackorderSuggestion>();

      rows.forEach((order: any) => {
        (order.shortage_items || []).forEach((item: any) => {
          const productId = item.product_id;
          const existing = aggregated.get(productId);
          if (existing) {
            existing.shortage += Number(item.shortage_qty || 0);
          } else {
            aggregated.set(productId, {
              id: productId,
              name: item.product_name,
              sku: item.sku,
              stock: Number(item.stock_quantity || 0),
              shortage: Number(item.shortage_qty || 0),
              base_price: Number(item.base_price || 0)
            });
          }
        });
      });

      setBackorderSuggestions(Array.from(aggregated.values()));
    } catch (error) {
      console.error('Failed to load backorder suggestions', error);
      setBackorderSuggestions([]);
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

  const addSuggestedItem = (product: Product) => {
    const stock = Number(product.stock_quantity || 0);
    const minStock = Number(product.min_stock || 0);
    const defaultQty = Math.max(1, (Math.max(minStock, 1) * 2) - stock);

    setItems(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, qty: Math.max(item.qty, defaultQty) }
            : item
        );
      }

      return [...prev, {
        product,
        qty: defaultQty,
        unit_cost: Number(product.base_price || 0)
      }];
    });
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
    } catch (error) {
      console.error('Create PO failed:', error);
      const err = error as any;
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
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0 lg:overflow-y-auto lg:pr-2">
            {/* Restock Suggestions */}
            <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm xl:col-span-1 xl:row-span-2 min-h-0 flex flex-col">
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
                <div className="grid grid-cols-1 gap-3 max-h-[350px] overflow-y-auto pr-1">
                  {restockSuggestions.map((product) => {
                    const stock = Number(product.stock_quantity || 0);
                    const minStock = Number(product.min_stock || 0);
                    const critical = stock <= 0;
                    const alreadyInDraft = items.some(item => item.product.id === product.id);

                    return (
                      <div key={product.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{product.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">SKU: {product.sku}</p>
                          </div>
                          <span className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider ${critical
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                            }`}>
                            {critical ? 'Habis' : 'Menipis'}
                          </span>
                        </div>

                        <div className="mt-2 text-xs text-slate-600">
                          Stok: <span className="font-bold">{stock}</span> • Min stok: <span className="font-bold">{minStock}</span>
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => addSuggestedItem(product)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${alreadyInDraft
                              ? 'bg-slate-200 text-slate-600 border-slate-300'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              }`}
                          >
                            {alreadyInDraft ? 'Sudah di Draft' : 'Tambah ke Draft PO'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Backorder Suggestions */}
            <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm xl:col-span-1 xl:row-span-2 min-h-0 flex flex-col">
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
                <div className="grid grid-cols-1 gap-3 max-h-[350px] overflow-y-auto pr-1">
                  {backorderSuggestions.map((item) => {
                    const alreadyInDraft = items.some(draftItem => draftItem.product.id === item.id);

                    return (
                      <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{item.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">SKU: {item.sku}</p>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider bg-rose-100 text-rose-700">
                            Butuh: {item.shortage}
                          </span>
                        </div>

                        <div className="mt-2 text-xs text-slate-600">
                          Stok Fisik Di Gudang: <span className="font-bold">{item.stock}</span>
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => {
                              const product: Product = {
                                id: item.id,
                                name: item.name,
                                sku: item.sku,
                                stock_quantity: item.stock,
                                base_price: item.base_price
                              };
                              setItems(prev => {
                                const existing = prev.find(p => p.product.id === product.id);
                                if (existing) {
                                  return prev.map(p =>
                                    p.product.id === product.id
                                      ? { ...p, qty: p.qty + item.shortage }
                                      : p
                                  );
                                }
                                return [...prev, {
                                  product,
                                  qty: item.shortage,
                                  unit_cost: item.base_price
                                }];
                              });
                            }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${alreadyInDraft
                              ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              }`}
                          >
                            {alreadyInDraft ? `Tambah (+${item.shortage})` : 'Tambah ke Draft PO'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
