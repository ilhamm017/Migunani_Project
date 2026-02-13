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
    imageUrl?: string;
    stock?: number;
    onAddToCart?: (productId: string) => void;
}

export default function ProductCard({
    id,
    name,
    price,
    imageUrl,
    stock = 0,
    onAddToCart,
}: ProductCardProps) {
    const isOutOfStock = stock <= 0;
    const isLowStock = stock > 0 && stock < 5;
    const normalizedImageUrl = normalizeProductImageUrl(imageUrl);

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

                    {/* Stock Badges */}
                    {isOutOfStock && (
                        <div className="absolute top-2 right-2 bg-rose-500 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-lg">
                            Habis
                        </div>
                    )}
                    {isLowStock && !isOutOfStock && (
                        <div className="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-lg">
                            Sisa {stock}
                        </div>
                    )}
                </div>

                <div className="p-3">
                    {/* Product Name */}
                    <h3 className="text-sm font-semibold text-slate-900 line-clamp-2 mb-1 min-h-[2.25rem]">
                        {name}
                    </h3>

                    {/* Price */}
                    <p className="text-sm font-black text-emerald-700 mb-2">
                        {formatCurrency(price)}
                    </p>

                    {/* Add to Cart Button */}
                    <button
                        className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all active:scale-95 ${isOutOfStock
                                ? 'bg-slate-100 text-slate-500'
                                : 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                            }`}
                        disabled={isOutOfStock}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onAddToCart && !isOutOfStock) {
                                onAddToCart(id);
                            }
                        }}
                    >
                        <ShoppingCart size={12} className="inline mr-1" />
                        {isOutOfStock ? 'Habis' : 'Tambah'}
                    </button>
                </div>
            </div>
        </Link>
    );
}
