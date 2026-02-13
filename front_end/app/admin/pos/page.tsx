'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Filter, Plus, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface CatalogProduct {
  id: string;
  name: string;
  sku?: string;
  price: number;
  stock_quantity: number;
  category_id?: number;
  Category?: {
    id: number;
    name: string;
  };
}

interface PosItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

interface PosCustomer {
  id: string;
  name: string;
  email?: string | null;
  whatsapp_number: string;
}

type PosPaymentMethod = 'cash' | 'transfer' | 'debt';

export default function PosPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'kasir']);

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_stock'>('all');
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, string>>({});
  const [hasSearchedProduct, setHasSearchedProduct] = useState(false);

  const [cart, setCart] = useState<PosItem[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [customerCandidates, setCustomerCandidates] = useState<PosCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [paying, setPaying] = useState(false);

  const hasProductCriteria = search.trim().length > 0 || selectedCategory !== 'all';

  const loadProducts = async () => {
    try {
      if (!hasProductCriteria) {
        setHasSearchedProduct(false);
        setProducts([]);
        setLoadingProducts(false);
        return;
      }

      setLoadingProducts(true);
      const params: any = {
        page: 1,
        limit: 200,
        search: search.trim() || undefined,
      };
      if (selectedCategory !== 'all') {
        params.category_id = Number(selectedCategory);
      }

      const res = await api.catalog.getProducts(params);
      const rows = (res.data?.products || []) as CatalogProduct[];
      setProducts(rows);
      setHasSearchedProduct(true);
    } catch (error) {
      console.error('Failed to load POS catalog:', error);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await api.catalog.getCategories({ limit: 20 });
      const rows = (res.data?.categories || []) as Array<{ id: number; name: string }>;
      setCategories(rows);
    } catch (error) {
      console.error('Failed to load categories:', error);
      setCategories([]);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    loadCategories();
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => void loadProducts(), 250);
    return () => clearTimeout(timer);
  }, [allowed, search, selectedCategory, hasProductCriteria]);

  useEffect(() => {
    if (!allowed) return;
    const keyword = customerWhatsapp.trim();
    if (keyword.length < 2) {
      setCustomerCandidates([]);
      setSelectedCustomer(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearchingCustomer(true);
        const res = await api.pos.searchCustomers(keyword);
        const rows = (res.data?.customers || []) as PosCustomer[];
        setCustomerCandidates(rows);

        const exact = rows.find((item) => item.whatsapp_number === keyword);
        if (exact) {
          setSelectedCustomer(exact);
          setCustomerName(exact.name || '');
        } else {
          setSelectedCustomer((prev) => (prev && prev.whatsapp_number !== keyword ? null : prev));
        }
      } catch (error) {
        console.error('Failed to search customer:', error);
        setCustomerCandidates([]);
      } finally {
        setSearchingCustomer(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [allowed, customerWhatsapp]);

  const filteredProducts = useMemo(() => {
    if (stockFilter === 'all') return products;
    if (stockFilter === 'in_stock') return products.filter((item) => Number(item.stock_quantity || 0) > 0);
    return products.filter((item) => Number(item.stock_quantity || 0) <= 0);
  }, [products, stockFilter]);

  if (!allowed) return null;

  const getRequestedQty = (productId: string) => {
    const raw = Number(qtyByProduct[productId] || '1');
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.trunc(raw);
  };

  const addToCart = (product: CatalogProduct) => {
    const qty = getRequestedQty(product.id);
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx].qty += qty;
        return next;
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          price: Number(product.price || 0),
          qty,
        },
      ];
    });
  };

  const setCartQty = (productId: string, qty: number) => {
    const normalizedQty = Number.isFinite(qty) ? Math.max(1, Math.trunc(qty)) : 1;
    setCart((prev) => prev.map((item) => (item.id === productId ? { ...item, qty: normalizedQty } : item)));
  };

  const removeCartItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cashValue = Number(cashReceived || 0);
  const change = Math.max(0, cashValue - total);

  const holdTransaction = async () => {
    if (cart.length === 0) return;
    try {
      await api.pos.holdOrder({
        customer_name: customerName.trim() || 'Walk-in Guest',
        items: cart.map((c) => ({ product_id: c.id, qty: c.qty })),
      });
      alert('Transaksi disimpan sebagai HOLD.');
      setCart([]);
      setCustomerName('');
      setCustomerWhatsapp('');
      setSelectedCustomer(null);
      setCustomerCandidates([]);
      setPaymentMethod('cash');
      setCashReceived('');
      await loadProducts();
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Gagal hold transaksi';
      alert(msg);
    }
  };

  const processPayment = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'cash' && cashValue < total) {
      alert('Uang tunai kurang dari total belanja.');
      return;
    }
    if (paymentMethod === 'debt' && !customerName.trim()) {
      alert('Pembayaran utang wajib isi nama customer.');
      return;
    }

    try {
      setPaying(true);
      const payload = {
        customer_name: customerName.trim() || 'Walk-in Guest',
        customer_whatsapp: selectedCustomer?.whatsapp_number || customerWhatsapp.trim() || undefined,
        payment_method: paymentMethod,
        cash_received: paymentMethod === 'cash' ? cashValue : undefined,
        items: cart.map((item) => ({
          product_id: item.id,
          qty: item.qty,
        })),
      } as const;

      const res = await api.pos.checkout(payload);
      const invoiceNumber = res.data?.invoice?.invoice_number || '-';
      const orderStatus = res.data?.order_status || '-';
      const pointsEarned = Number(res.data?.points_earned || 0);
      const isRegistered = !!res.data?.customer?.is_registered;

      alert(
        `Pembayaran berhasil.\nInvoice: ${invoiceNumber}\nStatus Order: ${orderStatus}${
          isRegistered ? `\nPoin bertambah: +${pointsEarned}` : ''
        }`
      );

      setPaymentOpen(false);
      setCart([]);
      setCustomerName('');
      setCustomerWhatsapp('');
      setSelectedCustomer(null);
      setCustomerCandidates([]);
      setPaymentMethod('cash');
      setCashReceived('');
      await loadProducts();
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Pembayaran gagal diproses';
      alert(msg);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">POS Store</h1>
        <Link href="/admin/pos/shift-report" className="text-sm font-bold text-emerald-700">
          Laporan Shift
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-slate-900">Menu Search Produk</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="relative md:col-span-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama / SKU produk..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={loadProducts}
              className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <Filter size={14} />
              Terapkan
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="all">Semua Kategori</option>
              {categories.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as 'all' | 'in_stock' | 'out_stock')}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="all">Semua Stok</option>
              <option value="in_stock">Hanya Tersedia</option>
              <option value="out_stock">Stok Habis</option>
            </select>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-auto pr-1">
            {!hasProductCriteria ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">
                Gunakan search produk atau pilih kategori dulu untuk menampilkan data.
              </div>
            ) : loadingProducts ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat produk...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">
                {hasSearchedProduct ? 'Produk tidak ditemukan.' : 'Belum ada hasil pencarian.'}
              </div>
            ) : (
              filteredProducts.map((item) => {
                const requestedQty = qtyByProduct[item.id] ?? '1';
                const stockQty = Number(item.stock_quantity || 0);
                return (
                  <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-600">
                        SKU: {item.sku || '-'} • {item.Category?.name || 'Tanpa Kategori'} • Stok: {stockQty}
                      </p>
                      <p className="text-xs font-bold text-emerald-700 mt-1">{formatCurrency(Number(item.price || 0))}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={requestedQty}
                        onChange={(e) => setQtyByProduct((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => addToCart(item)}
                        disabled={stockQty <= 0}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Plus size={12} />
                        Tambah
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-slate-900">Keranjang POS</h2>

          <input
            value={customerWhatsapp}
            onChange={(e) => setCustomerWhatsapp(e.target.value)}
            placeholder="Cari customer via nomor WhatsApp"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          {searchingCustomer && (
            <p className="text-[11px] text-slate-500">Mencari customer...</p>
          )}
          {customerCandidates.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 max-h-36 overflow-auto space-y-1">
              {customerCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => {
                    setSelectedCustomer(candidate);
                    setCustomerName(candidate.name || '');
                    setCustomerWhatsapp(candidate.whatsapp_number || '');
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs ${
                    selectedCustomer?.id === candidate.id ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-700'
                  }`}
                >
                  {candidate.name} ({candidate.whatsapp_number})
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <p className="text-[11px] text-emerald-700 font-semibold">
              Customer terdaftar: {selectedCustomer.name}
            </p>
          )}

          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nama customer"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />

          <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
            {cart.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">
                Keranjang kosong.
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-slate-600">
                        {formatCurrency(item.price)} / pcs
                      </p>
                    </div>
                    <button onClick={() => removeCartItem(item.id)} className="text-[11px] font-bold text-rose-600">
                      hapus
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCartQty(item.id, item.qty - 1)}
                      className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-sm font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => setCartQty(item.id, Number(e.target.value))}
                      className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center"
                    />
                    <button
                      onClick={() => setCartQty(item.id, item.qty + 1)}
                      className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-sm font-bold"
                    >
                      +
                    </button>
                    <p className="ml-auto text-xs font-bold text-slate-900">{formatCurrency(item.qty * item.price)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-slate-900 rounded-2xl p-3 text-white flex justify-between">
            <span className="text-sm">Total</span>
            <span className="text-lg font-black">{formatCurrency(total)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={holdTransaction}
              disabled={cart.length === 0}
              className="py-3 bg-amber-500 text-white rounded-xl text-xs font-bold uppercase disabled:opacity-50"
            >
              Hold
            </button>
            <button
              onClick={() => setPaymentOpen(true)}
              disabled={cart.length === 0}
              className="py-3 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase disabled:opacity-50"
            >
              Bayar
            </button>
          </div>
        </div>
      </div>

      {paymentOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-5 space-y-3 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">Pembayaran POS</h3>
            <p className="text-sm text-slate-600">
              Total belanja: <span className="font-black text-slate-900">{formatCurrency(total)}</span>
            </p>

            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PosPaymentMethod)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="cash">Tunai</option>
              <option value="transfer">Transfer</option>
              <option value="debt">Utang</option>
            </select>

            {paymentMethod === 'cash' && (
              <>
                <input
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder="Uang diterima"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
                <p className="text-sm text-slate-700">
                  Kembalian: <span className="font-black">{formatCurrency(change)}</span>
                </p>
              </>
            )}

            {paymentMethod === 'transfer' && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
                Transfer diproses sebagai pembayaran lunas di kasir.
              </div>
            )}

            {paymentMethod === 'debt' && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                Utang akan disimpan sebagai invoice unpaid dan masuk ke laporan piutang.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPaymentOpen(false)}
                disabled={paying}
                className="py-3 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
              >
                Batal
              </button>
              <button
                onClick={processPayment}
                disabled={paying}
                className="py-3 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
              >
                {paying ? 'Memproses...' : 'Selesaikan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
