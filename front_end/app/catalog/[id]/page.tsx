'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart, Package, Minus, Plus } from 'lucide-react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import { normalizeProductImageUrl } from '@/lib/image';
import { notifyAlert } from '@/lib/notify';

interface ProductDetail {
  id: string;
  name: string;
  sku?: string;
  price: number;
  imageUrl?: string;
  description?: string;
  unit?: string;
  category_name?: string;
}

type ProductCategory = {
  name?: string;
};

type ProductApiDetail = {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  image_url?: string | null;
  description?: string;
  unit?: string;
  Categories?: ProductCategory[];
  Category?: ProductCategory | null;
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const addItem = useCartStore((state) => state.addItem);

  const productId = String(params?.id || '');
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState(1);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const normalizedImageUrl = useMemo(() => normalizeProductImageUrl(product?.imageUrl), [product?.imageUrl]);

  useEffect(() => {
    if (!isZoomOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsZoomOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isZoomOpen]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.catalog.getProductById(productId);
        const p = res.data as ProductApiDetail;
        setProduct({
          id: String(p.id),
          name: p.name,
          sku: p.sku,
          price: Number(p.price || 0),
          imageUrl: p.image_url ? String(p.image_url) : undefined,
          description: p.description,
          unit: p.unit,
          category_name: Array.isArray(p.Categories) && p.Categories.length > 0
            ? p.Categories.map((item) => item?.name).filter(Boolean).join(', ')
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
      const normalizedQty = Math.max(1, Math.trunc(Number(qty) || 1));
      addItem({
        id: product.id,
        productId: product.id,
        productName: product.name,
        price: product.price,
        quantity: normalizedQty,
      });
      await api.cart.addToCart({ productId: product.id, quantity: normalizedQty });
      router.push('/cart');
    } catch (error) {
      console.error('Add to cart failed:', error);
      notifyAlert('Gagal menambahkan ke keranjang.');
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

  return (
    <div className="p-6 space-y-5">
      <button
        data-no-3d="true"
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <button
          type="button"
          onClick={() => {
            if (!normalizedImageUrl) return;
            setIsZoomOpen(true);
          }}
          className={[
            "relative w-full h-52 rounded-3xl bg-slate-100 overflow-hidden flex items-center justify-center",
            normalizedImageUrl ? "cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-emerald-600/60" : "cursor-default",
          ].join(' ')}
          aria-label={normalizedImageUrl ? "Perbesar gambar produk" : "Gambar produk tidak tersedia"}
          disabled={!normalizedImageUrl}
        >
          {normalizedImageUrl ? (
            <Image
              src={normalizedImageUrl}
              alt={product.name}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 640px"
              priority
            />
          ) : (
            <Package size={42} className="text-slate-400" />
          )}
        </button>

        {isZoomOpen && normalizedImageUrl ? (
          <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Zoom gambar produk"
            onClick={() => setIsZoomOpen(false)}
          >
            <div
              className="relative w-full max-w-4xl h-[70vh] sm:h-[80vh] rounded-2xl bg-black overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsZoomOpen(false)}
                className="absolute top-3 right-3 z-10 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-slate-900 hover:bg-white focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                Tutup
              </button>

              <div className="absolute inset-0 cursor-zoom-out">
                <Image
                  src={normalizedImageUrl}
                  alt={product.name}
                  fill
                  className="object-contain"
                  sizes="100vw"
                />
              </div>
            </div>
          </div>
        ) : null}

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
            <p className="text-[11px] text-slate-500">Ketersediaan</p>
            <p className="text-sm font-black text-slate-900">Diproses setelah pesanan dibuat</p>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold text-slate-900 mb-1">Spesifikasi</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{product.description || 'Belum ada deskripsi teknis produk.'}</p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] text-slate-500">Jumlah</p>
            <p className="text-sm font-black text-slate-900">{qty}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQty((prev) => Math.max(1, Number(prev || 1) - 1))}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 active:scale-95 transition-all"
              aria-label="Kurangi jumlah"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setQty((prev) => Math.max(1, Number(prev || 1) + 1))}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 active:scale-95 transition-all"
              aria-label="Tambah jumlah"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <button
          onClick={handleAddToCart}
          disabled={adding}
          className="w-full py-4 rounded-2xl text-sm font-black uppercase transition-all bg-emerald-600 text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
        >
          <ShoppingCart size={16} className="inline mr-2" />
          {adding ? 'Menambahkan...' : 'Tambah ke Keranjang'}
        </button>
      </div>
    </div>
  );
}
