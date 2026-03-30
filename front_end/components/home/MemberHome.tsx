'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Package, ShoppingCart, MessageSquare, ArrowRight, ScanLine, CreditCard, Search, Boxes, ReceiptText } from 'lucide-react';
import ProductCard from '@/components/product/ProductCard';
import ProductGrid from '@/components/product/ProductGrid';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils';

type ProductPreview = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
};

type OrderInvoiceSummary = {
  id: string;
  total: number;
  payment_status: string | null;
};

type MyOrderSummary = {
  id: string;
  Invoices?: OrderInvoiceSummary[] | null;
  Invoice?: OrderInvoiceSummary | null;
};

type HomeMeta = {
  productCount: number;
  categoryCount: number;
  orderCount: number;
};

const formatCount = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Math.max(0, Math.trunc(value)).toLocaleString('id-ID');
};

export default function MemberHome() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [products, setProducts] = useState<ProductPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) => state.totalItems);
  const [invoiceSummary, setInvoiceSummary] = useState({ count: 0, total: 0 });
  const [meta, setMeta] = useState<HomeMeta>({ productCount: 0, categoryCount: 0, orderCount: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [productsRes, categoriesRes, ordersRes] = await Promise.all([
          api.catalog.getProducts({ page: 1, limit: 4, featured: 'home' }),
          api.catalog.getCategories({ limit: 20 }),
          api.orders.getMyOrders({ page: 1, limit: 200 }),
        ]);
        const nextProducts: ProductPreview[] = Array.isArray(productsRes.data?.products)
          ? productsRes.data.products.map((product: Record<string, unknown>) => ({
            id: String(product.id ?? ''),
            name: String(product.name ?? ''),
            price: Number(product.price ?? 0),
            image_url: product.image_url ? String(product.image_url) : null,
          }))
          : [];
        setProducts(nextProducts);

        const orders: MyOrderSummary[] = Array.isArray(ordersRes.data?.orders) ? ordersRes.data.orders : [];
        const invoiceMap = new Map<string, OrderInvoiceSummary & { orderIds: string[] }>();
        orders.forEach((order) => {
          const invoices = Array.isArray(order?.Invoices) && order.Invoices.length > 0
            ? order.Invoices
            : order?.Invoice
              ? [order.Invoice]
              : [];
          invoices.forEach((invoice) => {
            const id = String(invoice?.id || '');
            if (!id) return;
            const existing = invoiceMap.get(id) || {
              id,
              total: Number(invoice?.total ?? 0),
              payment_status: invoice?.payment_status ? String(invoice.payment_status) : null,
              orderIds: [] as string[],
            };
            if (!existing.orderIds.includes(String(order.id))) {
              existing.orderIds.push(String(order.id));
            }
            invoiceMap.set(id, existing);
          });
        });
        const unpaidInvoices = Array.from(invoiceMap.values()).filter((inv) => {
          const status = String(inv?.payment_status || '');
          return status !== 'paid' && status !== 'cod_pending';
        });
        const total = unpaidInvoices.reduce((sum, inv) => sum + Number(inv?.total || 0), 0);
        setInvoiceSummary({ count: unpaidInvoices.length, total });

        const categoryRows = Array.isArray(categoriesRes.data?.categories) ? categoriesRes.data.categories : [];
        setMeta({
          productCount: Number(productsRes.data?.total ?? nextProducts.length),
          categoryCount: categoryRows.length,
          orderCount: Number(ordersRes.data?.total ?? orders.length),
        });
      } catch (error) {
        console.error('Failed to load home data:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleAddToCart = async (productId: string) => {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product) return;

    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    addItem({
      id: String(product.id),
      productId: String(product.id),
      productName: product.name,
      price: Number(product.price),
      quantity: 1,
      imageUrl: product.image_url ?? undefined,
    });

    try {
      await api.cart.addToCart({ productId: String(product.id), quantity: 1 });
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  };

  const combinedStats = [
    { label: 'Produk', value: loading ? '...' : formatCount(meta.productCount), color: 'bg-emerald-500', trend: 'Aktif', icon: Boxes },
    { label: 'Kategori', value: loading ? '...' : formatCount(meta.categoryCount), color: 'bg-blue-500', trend: 'Populer', icon: Package },
    { label: 'Keranjang', value: formatCount(cartCount), color: 'bg-amber-500', trend: 'Item', icon: ShoppingCart },
    { label: 'Pesanan', value: loading ? '...' : formatCount(meta.orderCount), color: 'bg-indigo-500', trend: 'Riwayat', icon: ReceiptText },
  ] as const;

  return (
    <div className="p-6 space-y-8">
      <Link href="/invoices" className="block">
        <div className={`rounded-3xl p-5 text-white flex items-center justify-between shadow-lg active:scale-[0.98] transition-all ${invoiceSummary.count > 0 ? 'bg-amber-500 shadow-amber-200' : 'bg-slate-700 shadow-slate-200'}`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <CreditCard size={24} className={invoiceSummary.count > 0 ? 'animate-pulse' : ''} />
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-tight">Invoice Customer</h4>
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">
                {invoiceSummary.count > 0
                  ? `${invoiceSummary.count} invoice perlu dibayar`
                  : 'Belum ada invoice berjalan'}
              </p>
              <p className="text-[11px] font-black opacity-90 mt-1">
                {invoiceSummary.count > 0 ? formatCurrency(invoiceSummary.total) : 'Rp 0'}
              </p>
            </div>
          </div>
          <ArrowRight size={20} className="opacity-60" />
        </div>
      </Link>

      <Link href="/promo/cepat-habis" className="block">
        <div className="rounded-3xl p-5 bg-emerald-600 text-white flex items-center justify-between shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-90">Promo</p>
            <h3 className="text-sm font-black">Promo Cepat Habis</h3>
            <p className="text-[11px] opacity-90 mt-1">Harga spesial untuk stok tertentu.</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center">
            <ArrowRight size={18} />
          </div>
        </div>
      </Link>

      <section className="grid grid-cols-2 gap-3">
        {combinedStats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="bg-white p-4 rounded-[28px] border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div className={`p-2 rounded-xl ${stat.color} text-white`}>
                  <Icon size={16} />
                </div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{stat.trend}</span>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">{stat.label}</p>
              <h3 className="text-lg font-black">{stat.value}</h3>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Produk Unggulan</h3>
          <Link href="/catalog" className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
            Lihat Semua
          </Link>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 opacity-50">
            <Search className="animate-spin text-emerald-500 mb-2" size={20} />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Memuat Produk...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
            <p className="text-xs font-bold text-slate-400">Belum ada produk unggulan.</p>
          </div>
        ) : (
          <ProductGrid>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                id={String(product.id)}
                name={product.name}
                price={Number(product.price)}
                imageUrl={product.image_url ?? undefined}
                onAddToCart={handleAddToCart}
              />
            ))}
          </ProductGrid>
        )}
      </section>

      <section className="bg-gradient-to-br from-slate-800 via-slate-800 to-emerald-900 rounded-[32px] p-6 text-white shadow-xl border border-slate-700/40">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200 mb-4">Akses Cepat</h3>
        <div className="grid grid-cols-3 gap-4">
          <Link href="/catalog" className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center border border-white/20"><ScanLine size={20} /></div>
            <span className="text-xs font-semibold text-slate-100">Katalog</span>
          </Link>
          <Link href="/cart" className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center border border-white/20"><ShoppingCart size={20} /></div>
            <span className="text-xs font-semibold text-slate-100">Keranjang</span>
          </Link>
          <Link href="/orders" className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center border border-white/20"><Package size={20} /></div>
            <span className="text-xs font-semibold text-slate-100">Pesanan</span>
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div className="bg-white p-4 rounded-3xl border border-slate-100 flex items-center gap-4 active:scale-95 transition-all shadow-sm">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600">
            <MessageSquare size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Customer Support</p>
            <h4 className="text-xs font-bold text-slate-900">Hubungi via WhatsApp</h4>
            <p className="text-[11px] font-black text-emerald-600 mt-1">24/7 Online</p>
          </div>
          <ArrowRight size={16} className="text-slate-300" />
        </div>
      </section>
    </div>
  );
}
