'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart, Package, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';

interface ProductDetail {
  id: string;
  name: string;
  sku?: string;
  price: number;
  stock_quantity?: number;
  description?: string;
  unit?: string;
  category_name?: string;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const addItem = useCartStore((state) => state.addItem);

  const productId = String(params?.id || '');
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.catalog.getProductById(productId);
        const p = res.data;
        setProduct({
          id: String(p.id),
          name: p.name,
          sku: p.sku,
          price: Number(p.price || 0),
          stock_quantity: Number(p.stock_quantity || 0),
          description: p.description,
          unit: p.unit,
          category_name: Array.isArray(p.Categories) && p.Categories.length > 0
            ? p.Categories.map((item: any) => item?.name).filter(Boolean).join(', ')
            : p.Category?.name,
        });
      } catch (error) {
        console.error('Failed to load product detail:', error);
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    if (productId) load();
  }, [productId]);

  const tierPriceText = useMemo(() => {
    if (!product) return '-';
    return formatCurrency(product.price);
  }, [product]);

  const handleAddToCart = async () => {
    if (!product) return;

    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    try {
      setAdding(true);
      addItem({
        id: product.id,
        productId: product.id,
        productName: product.name,
        price: product.price,
        quantity: 1,
      });
      await api.cart.addToCart({ productId: product.id, quantity: 1 });
      router.push('/cart');
    } catch (error) {
      console.error('Add to cart failed:', error);
      alert('Gagal menambahkan ke keranjang.');
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <p className="text-sm text-slate-500">Memuat detail produk...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-slate-500">Produk tidak ditemukan.</p>
        <Link href="/catalog" className="text-sm font-bold text-emerald-700">Kembali ke katalog</Link>
      </div>
    );
  }

  const outOfStock = (product.stock_quantity || 0) <= 0;

  return (
    <div className="p-6 space-y-5">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <div className="w-full h-52 rounded-3xl bg-slate-100 flex items-center justify-center">
          <Package size={42} className="text-slate-400" />
        </div>

        <div>
          <h1 className="text-xl font-black text-slate-900">{product.name}</h1>
          <p className="text-xs text-slate-500 mt-1">SKU: {product.sku || '-'} • Kategori: {product.category_name || '-'}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-2xl p-3">
            <p className="text-[11px] text-slate-500">Harga</p>
            <p className="text-sm font-black text-emerald-700">{tierPriceText}</p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-3 text-center col-span-2 sm:col-span-1">
            <p className="text-[11px] text-slate-500">Status Stok</p>
            <p className={`text-sm font-black ${outOfStock ? 'text-rose-600' : 'text-emerald-700'}`}>
              {outOfStock ? 'Stok Habis' : 'Tersedia'}
            </p>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 flex items-start gap-2">
          <ShieldCheck size={16} className="text-emerald-600 mt-0.5" />
          <p className="text-xs text-emerald-700">Harga akan otomatis menyesuaikan tier pelanggan saat login (regular/gold/platinum).</p>
        </div>

        <div>
          <h2 className="text-sm font-bold text-slate-900 mb-1">Spesifikasi</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{product.description || 'Belum ada deskripsi teknis produk.'}</p>
        </div>

        <button
          onClick={handleAddToCart}
          disabled={outOfStock || adding}
          className={`w-full py-4 rounded-2xl text-sm font-black uppercase transition-all ${outOfStock ? 'bg-slate-100 text-slate-500' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-200'}`}
        >
          <ShoppingCart size={16} className="inline mr-2" />
          {outOfStock ? 'Stok Habis' : adding ? 'Menambahkan...' : 'Tambah ke Keranjang'}
        </button>
      </div>
    </div>
  );
}
