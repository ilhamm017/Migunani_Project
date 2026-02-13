'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Package,
  ShieldCheck,
  Truck,
  Star,
  ShoppingCart,
  ArrowRight,
  Droplets,
  Settings,
  CircleDot,
  Disc3,
  Lightbulb,
  BatteryCharging,
  Funnel,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

interface PopularCategory {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
}

const AUTO_GENERATED_CATEGORY_DESCRIPTIONS = new Set([
  'auto-created from inventory import',
]);

type IconComponent = typeof Droplets;

const fallbackProducts: CatalogProduct[] = [
  { id: 'BAN-001', name: 'Ban Motor Tubeless 80/90-17', price: 250000, stock: 25, category: 'Ban Motor' },
  { id: 'OLI-001', name: 'Oli Mesin Synthetic 1L - SHELL', price: 85000, stock: 50, category: 'Oli & Pelumas' },
  { id: 'MSN-001', name: 'Piston Kit Honda Beat', price: 230000, stock: 8, category: 'Suku Cadang Mesin' },
];

const fallbackPopularCategories: PopularCategory[] = [
  { id: 1, name: 'Oli & Pelumas', description: 'Pelumas mesin & cairan', icon: 'droplets' },
  { id: 2, name: 'Suku Cadang Mesin', description: 'Komponen mesin harian', icon: 'settings' },
  { id: 3, name: 'Ban Motor', description: 'Ban tubeless & harian', icon: 'circle-dot' },
];

const cardStyles = [
  { className: 'bg-emerald-50 text-emerald-700', bubbleClassName: 'bg-emerald-100' },
  { className: 'bg-blue-50 text-blue-700', bubbleClassName: 'bg-blue-100' },
  { className: 'bg-amber-50 text-amber-700', bubbleClassName: 'bg-amber-100' },
];

const categoryIconMap: Record<string, IconComponent> = {
  droplets: Droplets,
  settings: Settings,
  'circle-dot': CircleDot,
  'disc-3': Disc3,
  lightbulb: Lightbulb,
  'battery-charging': BatteryCharging,
  funnel: Funnel,
  package: Package,
};

export default function GuestLanding() {
  const [products, setProducts] = useState<CatalogProduct[]>(fallbackProducts);
  const [popularCategories, setPopularCategories] = useState<PopularCategory[]>(fallbackPopularCategories);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLandingData = async () => {
      try {
        const [productResponse, categoriesResponse] = await Promise.all([
          api.catalog.getProducts({ page: 1, limit: 6 }),
          api.catalog.getCategories({ limit: 3 }),
        ]);

        const rows = Array.isArray(productResponse.data?.products) ? productResponse.data.products : [];
        const categoryRows = Array.isArray(categoriesResponse.data?.categories) ? categoriesResponse.data.categories : [];

        const mapped: CatalogProduct[] = rows.slice(0, 3).map((item: any) => ({
          id: String(item.id),
          name: item.name,
          price: Number(item.price),
          stock: Number(item.stock_quantity || 0),
          category: item.Category?.name || 'Sparepart',
        }));

        const mappedCategories: PopularCategory[] = categoryRows.slice(0, 3).map((item: any) => ({
          id: Number(item.id),
          name: String(item.name || ''),
          description: (() => {
            const rawDescription = item.description ? String(item.description).trim() : '';
            if (!rawDescription) return null;
            if (AUTO_GENERATED_CATEGORY_DESCRIPTIONS.has(rawDescription.toLowerCase())) return null;
            return rawDescription;
          })(),
          icon: item.icon ? String(item.icon).toLowerCase() : null,
        }));

        if (mapped.length > 0) {
          setProducts(mapped);
        }
        if (mappedCategories.length > 0) {
          setPopularCategories(mappedCategories);
        }
      } catch (error) {
        console.error('Failed to load guest landing data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadLandingData();
  }, []);

  return (
    <div className="p-6 space-y-8">
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 rounded-[40px] p-8 text-white relative overflow-hidden shadow-2xl shadow-slate-300/30">
        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full border border-white/10">
            <Star size={12} className="text-amber-400" fill="currentColor" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Sparepart Terpercaya</span>
          </div>
          <h1 className="text-3xl font-black leading-tight">
            Suku Cadang Motor
            <br />
            <span className="text-emerald-400">Asli & Lengkap.</span>
          </h1>
          <p className="text-sm text-slate-200 leading-relaxed max-w-[280px]">
            Belanja sparepart motor dengan harga transparan, stok real-time, dan dukungan admin via WhatsApp.
          </p>
          <div className="pt-3 flex gap-3">
            <Link href="/catalog" className="bg-emerald-600 px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-900/30 active:scale-95 transition-all">
              Lihat Katalog
            </Link>
            <Link href="/auth/register" className="bg-white/10 px-5 py-3 rounded-2xl font-bold text-sm border border-white/20 active:scale-95 transition-all">
              Daftar
            </Link>
          </div>
        </div>
        <div className="absolute -right-16 -bottom-14 text-[170px] font-black italic opacity-10 select-none rotate-12">
          MM
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-3xl border border-slate-200 text-center flex flex-col items-center gap-2 shadow-sm">
          <ShieldCheck size={20} className="text-emerald-600" />
          <span className="text-[10px] font-bold text-slate-500 uppercase leading-none">Barang Ori</span>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200 text-center flex flex-col items-center gap-2 shadow-sm">
          <Truck size={20} className="text-emerald-600" />
          <span className="text-[10px] font-bold text-slate-500 uppercase leading-none">Kirim Cepat</span>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200 text-center flex flex-col items-center gap-2 shadow-sm">
          <Package size={20} className="text-emerald-600" />
          <span className="text-[10px] font-bold text-slate-500 uppercase leading-none">Stok Lengkap</span>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest leading-none">Kategori Populer</h2>
          <Link href="/catalog" className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
            Lihat Semua <ChevronRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {popularCategories.map((category, index) => {
            const style = cardStyles[index % cardStyles.length];
            const iconKey = category.icon ? category.icon.toLowerCase().replace(/_/g, '-') : '';
            const Icon = iconKey ? categoryIconMap[iconKey] : undefined;
            return (
              <Link
                key={`${category.id}-${category.name}`}
                href={`/catalog?search=${encodeURIComponent(category.name)}`}
                className={`rounded-[28px] p-5 flex flex-col gap-3 relative overflow-hidden active:scale-95 transition-transform ${style.className}`}
              >
                {Icon ? <Icon size={30} /> : null}
                <div>
                  <h3 className="font-bold">{category.name}</h3>
                  <p className="text-xs opacity-80">{category.description || 'Kategori sparepart'}</p>
                </div>
                <div className={`absolute -right-4 -bottom-4 w-16 h-16 rounded-full opacity-50 ${style.bubbleClassName}`}></div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest leading-none">Produk Terlaris</h2>
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm">
              <p className="text-sm text-slate-500">Memuat produk unggulan...</p>
            </div>
          ) : (
            products.map((product) => (
              <div key={product.id} className="bg-white border border-slate-200 p-4 rounded-3xl flex gap-4 shadow-sm">
                <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center font-bold text-slate-500 text-[11px]">
                  {product.category.slice(0, 3).toUpperCase()}
                </div>
                <div className="flex-1 flex flex-col justify-center">
                  <h4 className="text-sm font-bold text-slate-900">{product.name}</h4>
                  <p className="text-xs text-slate-500 mt-1">Kategori: {product.category}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-sm font-black text-slate-900">{formatCurrency(product.price)}</p>
                    <span className="text-xs text-slate-500">Stok: {product.stock}</span>
                  </div>
                </div>
                <div className="flex items-center">
                  <Link href="/auth/login" className="p-2.5 bg-slate-100 text-slate-500 rounded-xl hover:text-emerald-600 transition-colors">
                    <ShoppingCart size={18} />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-emerald-600 rounded-[32px] p-7 text-white text-center space-y-4 shadow-xl shadow-emerald-200/50">
        <h3 className="text-xl font-black">Siap Belanja?</h3>
        <p className="text-sm opacity-90 px-2">
          Daftar akun gratis untuk checkout, pantau pesanan, dan akses promo member.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/auth/login" className="w-full py-3 bg-emerald-700 rounded-2xl font-bold text-sm">
            Login
          </Link>
          <Link href="/auth/register" className="w-full py-3 bg-white text-emerald-700 rounded-2xl font-bold text-sm shadow-xl">
            Daftar Gratis
          </Link>
        </div>
        <Link href="/catalog" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide">
          Lanjut sebagai tamu <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}
