'use client';

import { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import ProductCard from '@/components/product/ProductCard';
import ProductGrid from '@/components/product/ProductGrid';
import { ScrollChips, ChipItem } from '@/components/ui/ScrollChips';
import { api } from '@/lib/api';
import { useCartStore } from '@/store/cartStore';

interface Product {
    id: string;
    name: string;
    price: number;
    imageUrl?: string;
    stock?: number;
}

const CATALOG_PAGE_SIZE = 20;

// Filter categories
const filterCategories: ChipItem[] = [
    { id: 'all', label: 'Semua' },
    { id: 'motor', label: 'Motor' },
    { id: 'ban', label: 'Ban' },
    { id: 'oli', label: 'Oli' },
    { id: 'kampas', label: 'Rem' },
    { id: 'lampu', label: 'Lampu' },
    { id: 'aksesoris', label: 'Aksesoris' },
];

function CatalogContent() {
    const searchParams = useSearchParams();
    const addItem = useCartStore((state) => state.addItem);
    const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchQuery, setSearchQuery] = useState(searchParams?.get('search') || '');
    const [appliedSearch, setAppliedSearch] = useState(searchParams?.get('search') || '');
    const [showFilters, setShowFilters] = useState(false);
    const [activeCategory, setActiveCategory] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    const mapApiProduct = (item: any): Product => ({
        id: String(item.id),
        name: String(item.name || ''),
        price: Number(item.price || 0),
        imageUrl: item.image_url ? String(item.image_url) : undefined,
        stock: Number(item.stock_quantity || 0),
    });

    const loadProducts = useCallback(async (targetPage: number, append: boolean) => {
        try {
            if (append) {
                setLoadingMore(true);
            } else {
                setLoading(true);
            }

            const response = await api.catalog.getProducts({
                search: appliedSearch || undefined,
                page: targetPage,
                limit: CATALOG_PAGE_SIZE,
            });
            const rows = Array.isArray(response.data?.products) ? response.data.products : [];
            const mapped = rows.map(mapApiProduct);
            const nextCurrentPage = Number(response.data?.currentPage || targetPage);
            const nextTotalPages = Number(response.data?.totalPages || 1);

            setCurrentPage(nextCurrentPage);
            setTotalPages(nextTotalPages);
            setHasMore(nextCurrentPage < nextTotalPages);

            setProducts((prev) => {
                if (!append) return mapped;

                const merged = [...prev, ...mapped];
                const uniqueMap = new Map<string, Product>();
                merged.forEach((item) => uniqueMap.set(item.id, item));
                return [...uniqueMap.values()];
            });
        } catch (error) {
            console.error('Failed to load products:', error);
        } finally {
            if (append) {
                setLoadingMore(false);
            } else {
                setLoading(false);
            }
        }
    }, [appliedSearch]);

    useEffect(() => {
        loadProducts(1, false);
    }, [appliedSearch, loadProducts]);

    useEffect(() => {
        const fromUrl = searchParams?.get('search') || '';
        setSearchQuery(fromUrl);
        setAppliedSearch(fromUrl);
    }, [searchParams]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setAppliedSearch(searchQuery.trim());
    };

    const handleAddToCart = async (productId: string) => {
        const product = products.find((p) => p.id === productId);
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

    useEffect(() => {
        const node = loadMoreTriggerRef.current;
        if (!node) return;
        if (loading || loadingMore || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry?.isIntersecting) return;
                if (loading || loadingMore || !hasMore) return;
                void loadProducts(currentPage + 1, true);
            },
            { root: null, rootMargin: '300px 0px', threshold: 0.1 }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [currentPage, hasMore, loading, loadingMore, loadProducts]);

    return (
        <div className="p-6 space-y-6">
            {/* Search Bar */}
            <form onSubmit={handleSearch}>
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            placeholder="Cari suku cadang..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white rounded-2xl py-3.5 pl-12 pr-4 text-sm border border-slate-100 shadow-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowFilters(!showFilters)}
                        className={`p-3 rounded-2xl border border-slate-100 shadow-sm transition-all active:scale-95 ${showFilters ? 'bg-emerald-600 text-white' : 'bg-white text-slate-400'}`}
                    >
                        <SlidersHorizontal size={20} />
                    </button>
                </div>
            </form>

            {/* Category Chips */}
            <ScrollChips
                items={filterCategories}
                activeId={activeCategory}
                onItemClick={(id) => {
                    setActiveCategory(id);
                    console.log('Filter by category:', id);
                }}
            />

            {/* Advanced Filters */}
            {showFilters && (
                <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Filter Lanjutan</h3>
                        <button
                            onClick={() => setShowFilters(false)}
                            className="p-2 bg-slate-50 rounded-full text-slate-400"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                        Filter harga, merek, dan lainnya akan ditambahkan di sini...
                    </p>
                </div>
            )}

            {/* Section Label */}
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Katalog Produk</h3>
                <span className="text-[10px] font-bold text-slate-400">
                    {products.length} Produk • Hal {currentPage}/{totalPages}
                </span>
            </div>

            {/* Products Grid */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4 animate-pulse">
                        <Search size={20} className="text-emerald-600" />
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Memuat produk...</p>
                </div>
            ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                        <Search size={24} className="text-slate-300" />
                    </div>
                    <p className="text-xs font-bold text-slate-900 mb-1">Tidak Ditemukan</p>
                    <p className="text-[10px] text-slate-400">Coba kata kunci lain</p>
                </div>
            ) : (
                <>
                    <ProductGrid>
                        {products.map((product: Product) => (
                            <ProductCard
                                key={product.id}
                                {...product}
                                onAddToCart={handleAddToCart}
                            />
                        ))}
                    </ProductGrid>

                    <div ref={loadMoreTriggerRef} className="h-8" />

                    {loadingMore && (
                        <div className="flex justify-center py-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Memuat halaman berikutnya...</p>
                        </div>
                    )}

                    {!hasMore && products.length > 0 && (
                        <div className="flex justify-center py-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Semua produk sudah ditampilkan</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function CatalogPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center py-20">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Loading...</p>
            </div>
        }>
            <CatalogContent />
        </Suspense>
    );
}
