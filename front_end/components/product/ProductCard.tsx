'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { normalizeProductImageUrl } from '@/lib/image';

interface ProductCardProps {
    id: string;
    name: string;
    price: number;
    originalPrice?: number;
    discountPct?: number;
    imageUrl?: string;
    stock?: number;
    onAddToCart?: (productId: string) => void;
}

export default function ProductCard({
    id,
    name,
    price,
    originalPrice,
    discountPct,
    imageUrl,
    onAddToCart,
}: ProductCardProps) {
    const normalizedImageUrl = normalizeProductImageUrl(imageUrl);
    const showDiscount = Number.isFinite(Number(originalPrice)) && Number(originalPrice) > Number(price) && Number.isFinite(Number(discountPct)) && Number(discountPct) > 0;

    return (
        <Link href={`/catalog/${id}`}>
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden active:scale-95 transition-all group">
                {/* Image Container */}
                <div className="relative aspect-square bg-slate-50">
                    {normalizedImageUrl ? (
                        <Image
                            src={normalizedImageUrl}
                            alt={name}
                            fill
                            className="object-cover group-hover:scale-105 transition-all"
                            sizes="(max-width: 768px) 50vw, 33vw"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <ShoppingCart size={32} />
                        </div>
                    )}
                </div>

                <div className="p-3">
                    {/* Product Name */}
                    <h3 className="text-sm font-semibold text-slate-900 line-clamp-2 mb-1 min-h-[2.25rem]">
                        {name}
                    </h3>

                    {/* Price */}
                    <div className="mb-2">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-black text-emerald-700">
                                {formatCurrency(price)}
                            </p>
                            {showDiscount ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide bg-rose-50 text-rose-700 border border-rose-200">
                                    -{Math.round(Number(discountPct))}%
                                </span>
                            ) : null}
                        </div>
                        {showDiscount ? (
                            <p className="text-[11px] font-bold text-slate-400 line-through">
                                {formatCurrency(Number(originalPrice))}
                            </p>
                        ) : null}
                    </div>

                    {/* Add to Cart Button */}
                    <button
                        className="btn-3d w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all active:scale-95 bg-emerald-600 text-white shadow-sm shadow-emerald-200"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onAddToCart) {
                                onAddToCart(id);
                            }
                        }}
                    >
                        <ShoppingCart size={12} className="inline mr-1" />
                        Tambah
                    </button>
                </div>
            </div>
        </Link>
    );
}
