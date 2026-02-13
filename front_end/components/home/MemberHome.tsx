'use client';

import Link from 'next/link';
import { TrendingUp, Package, ShoppingCart, MessageSquare, ArrowRight, ScanLine, CreditCard } from 'lucide-react';
import ProductCard from '@/components/product/ProductCard';
import ProductGrid from '@/components/product/ProductGrid';
import { useCartStore } from '@/store/cartStore';
import { api } from '@/lib/api';

const combinedStats = [
  { label: 'Produk', value: '120+', color: 'bg-emerald-500', trend: 'Tersedia', icon: Package },
  { label: 'Kategori', value: '8', color: 'bg-blue-500', trend: 'Lengkap', icon: TrendingUp },
  { label: 'Promo', value: '5', color: 'bg-amber-500', trend: 'Aktif', icon: CreditCard },
  { label: 'Chat', value: '24/7', color: 'bg-indigo-500', trend: 'Online', icon: MessageSquare },
];

const featuredProducts = [
  {
    id: '1',
    name: 'Ban Motor Tubeless 80/90-17',
    price: 250000,
    stock: 15,
    imageUrl: '/images/products/ban.jpg',
  },
  {
    id: '2',
    name: 'Oli Mesin Synthetic 1L',
    price: 85000,
    stock: 30,
    imageUrl: '/images/products/oli.jpg',
  },
  {
    id: '3',
    name: 'Kampas Rem Depan Honda',
    price: 45000,
    stock: 0,
    imageUrl: '/images/products/kampas.jpg',
  },
  {
    id: '4',
    name: 'Lampu LED Motor H4',
    price: 120000,
    stock: 8,
    imageUrl: '/images/products/lampu.jpg',
  },
];

export default function MemberHome() {
  const addItem = useCartStore((state) => state.addItem);

  const handleAddToCart = async (productId: string) => {
    const product = featuredProducts.find((p) => p.id === productId);
    if (!product) return;

    addItem({
      id: productId,
      productId,
      productName: product.name,
      price: product.price,
      quantity: 1,
      imageUrl: product.imageUrl,
    });

    try {
      await api.cart.addToCart({ productId, quantity: 1 });
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  };

  return (
    <div className="p-6 space-y-8">
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

        <ProductGrid>
          {featuredProducts.map((product) => (
            <ProductCard
              key={product.id}
              {...product}
              onAddToCart={handleAddToCart}
            />
          ))}
        </ProductGrid>
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
