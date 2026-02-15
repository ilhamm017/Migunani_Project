'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    getSortedRowModel,
    ColumnDef,
    SortingState,
} from '@tanstack/react-table';
import { api } from '@/lib/api';
import { ProductRow } from '../../inventory/types';
import { warehouseColumns, warehouseEditActionColumn } from '../warehouse-columns';
import WarehouseDetailPanel from '../warehouse-detail';
import {
    Search, Filter, ChevronLeft, ChevronRight, X, AlertTriangle, Package, TrendingDown, PencilLine
} from 'lucide-react';

const PRODUCTS_PER_PAGE = 50;

export default function WarehouseInventoryPage() {
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalProducts, setTotalProducts] = useState(0);
    const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [isEditMode, setIsEditMode] = useState(false);
    const [detailMode, setDetailMode] = useState<'info' | 'edit'>('info');

    // Summary stats
    const stats = useMemo(() => {
        const kosong = products.filter(p => Number(p.stock_quantity || 0) === 0).length;
        const low = products.filter(p => {
            const s = Number(p.stock_quantity || 0);
            return s > 0 && s <= Number(p.min_stock || 0);
        }).length;
        return { total: totalProducts, kosong, low };
    }, [products, totalProducts]);

    const loadProducts = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = {
                page: currentPage,
                limit: PRODUCTS_PER_PAGE,
                status: 'all',
            };
            if (search.trim()) params.search = search.trim();
            if (selectedCategory !== 'all') params.category_id = Number(selectedCategory);

            const res = await api.admin.inventory.getProducts(params);
            setProducts(res.data?.products || []);
            setTotalProducts(Number(res.data?.total || 0));
            setTotalPages(Math.max(1, Number(res.data?.totalPages || 1)));
        } catch {
            // Silently handle errors
        } finally {
            setLoading(false);
        }
    }, [currentPage, search, selectedCategory]);

    const loadCategories = useCallback(async () => {
        try {
            const res = await api.admin.inventory.getCategories();
            setCategories(res.data?.categories || []);
        } catch {
            // Silently handle
        }
    }, []);

    useEffect(() => { void loadCategories(); }, [loadCategories]);

    useEffect(() => {
        const timer = setTimeout(() => { void loadProducts(); }, 200);
        return () => clearTimeout(timer);
    }, [loadProducts]);

    useEffect(() => {
        if (!selectedProduct) return;
        const latest = products.find((item) => item.id === selectedProduct.id);
        if (latest) {
            setSelectedProduct(latest);
        }
    }, [products, selectedProduct?.id]);

    const handleProductUpdated = useCallback((nextProduct: ProductRow) => {
        setSelectedProduct(nextProduct);
        setProducts((prev) => prev.map((item) => (item.id === nextProduct.id ? { ...item, ...nextProduct } : item)));
        void loadProducts();
    }, [loadProducts]);

    const patchProductState = useCallback((productId: string, patch: Partial<ProductRow>) => {
        setProducts((prev) => prev.map((item) => (item.id === productId ? { ...item, ...patch } : item)));
        setSelectedProduct((prev) => (prev && prev.id === productId ? { ...prev, ...patch } : prev));
    }, []);

    const handleInlineUpdate = useCallback(async (product: ProductRow, field: 'barcode' | 'name' | 'bin_location' | 'min_stock' | 'base_price' | 'status', value: string | number) => {
        const payload: Record<string, string | number> = { [field]: value };
        await api.admin.inventory.updateProduct(product.id, payload);

        if (field === 'status') {
            patchProductState(product.id, { status: String(value) === 'inactive' ? 'inactive' : 'active' });
            return;
        }

        if (field === 'min_stock' || field === 'base_price') {
            patchProductState(product.id, { [field]: Number(value || 0) } as Partial<ProductRow>);
            return;
        }

        patchProductState(product.id, { [field]: String(value || '') } as Partial<ProductRow>);
    }, [patchProductState]);

    const handleAdjustStock = useCallback(async (product: ProductRow, nextStock: number) => {
        const currentStock = Number(product.stock_quantity || 0);
        if (nextStock === currentStock) return;

        const diff = nextStock - currentStock;
        await api.admin.inventory.createMutation({
            product_id: product.id,
            type: diff > 0 ? 'in' : 'out',
            qty: Math.abs(diff),
            note: 'Penyesuaian stok dari inline mode edit Warehouse Command Center',
            reference_id: `WCC-INLINE-${Date.now()}`
        });

        patchProductState(product.id, { stock_quantity: nextStock });
    }, [patchProductState]);

    const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
        if (!isEditMode) return warehouseColumns;
        return [...warehouseColumns, warehouseEditActionColumn];
    }, [isEditMode]);

    const table = useReactTable({
        data: products,
        columns,
        getCoreRowModel: getCoreRowModel(),
        onSortingChange: setSorting,
        getSortedRowModel: getSortedRowModel(),
        state: { sorting },
        meta: {
            refreshData: loadProducts,
            isEditMode,
            onInlineUpdate: handleInlineUpdate,
            onAdjustStock: handleAdjustStock,
            onExpandEdit: (product: ProductRow) => {
                setSelectedProduct(product);
                setDetailMode('edit');
            },
        },
    });

    const pageStart = totalProducts === 0 ? 0 : (currentPage - 1) * PRODUCTS_PER_PAGE + 1;
    const pageEnd = totalProducts === 0 ? 0 : Math.min(currentPage * PRODUCTS_PER_PAGE, totalProducts);

    return (
        <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom warehouse-screen-edge-to-edge flex min-h-0 flex-col overflow-hidden bg-slate-50">
            {/* Stats Bar */}
            <div className="warehouse-panel flex-shrink-0 px-4 md:px-6 py-3 bg-white border-b border-slate-200">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    {/* Mini Stats */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                            <Package size={14} className="text-slate-500" />
                            <span className="text-xs font-bold text-slate-700">{stats.total} produk</span>
                        </div>
                        {stats.low > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                                <TrendingDown size={14} className="text-amber-600" />
                                <span className="text-xs font-bold text-amber-700">{stats.low} Low</span>
                            </div>
                        )}
                        {stats.kosong > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200">
                                <AlertTriangle size={14} className="text-rose-600" />
                                <span className="text-xs font-bold text-rose-700">{stats.kosong} Kosong</span>
                            </div>
                        )}
                    </div>

                    {/* Search & Filter */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setIsEditMode((prev) => {
                                    const next = !prev;
                                    if (!next) setDetailMode('info');
                                    return next;
                                });
                            }}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black border min-h-0 min-w-0 ${isEditMode
                                ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                                }`}
                        >
                            <PencilLine size={13} />
                            {isEditMode ? 'Mode Edit Aktif' : 'Aktifkan Mode Edit'}
                        </button>
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                                placeholder="Cari nama, SKU, barcode..."
                                className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs w-64 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none"
                            />
                            {search && (
                                <button onClick={() => { setSearch(''); setCurrentPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 min-h-0 min-w-0 p-0.5">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        <div className="relative">
                            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <select
                                value={selectedCategory}
                                onChange={(e) => { setSelectedCategory(e.target.value); setCurrentPage(1); }}
                                className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs appearance-none cursor-pointer focus:border-emerald-400 outline-none"
                            >
                                <option value="all">Semua Kategori</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Split View */}
            <div className="flex-1 flex overflow-hidden">
                {/* Data Grid (Left) */}
                <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${selectedProduct ? 'md:w-[60%]' : 'w-full'}`}>
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-sm text-left border-collapse min-w-[1250px]">
                            {/* Sticky Header */}
                            <thead className="sticky top-0 z-10">
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <tr key={headerGroup.id} className="bg-slate-50 border-b border-slate-200">
                                        {headerGroup.headers.map((header, idx) => (
                                            <th
                                                key={header.id}
                                                className={`px-4 py-3 bg-slate-50 ${idx === 2 ? 'sticky left-0 z-20 bg-slate-50 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)]' : ''}`}
                                                style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                                            >
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(header.column.columnDef.header, header.getContext())}
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            {/* Table Body */}
                            <tbody className="bg-white divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={columns.length} className="h-32 text-center">
                                            <div className="flex items-center justify-center gap-2 text-slate-400">
                                                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-sm">Memuat data...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : table.getRowModel().rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={columns.length} className="h-32 text-center text-slate-400 text-sm">
                                            Tidak ada produk ditemukan.
                                        </td>
                                    </tr>
                                ) : (
                                    table.getRowModel().rows.map((row) => {
                                        const isSelected = (row.original as any).id === selectedProduct?.id;
                                        return (
                                            <tr
                                                key={row.id}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedProduct(null);
                                                        return;
                                                    }
                                                    setSelectedProduct(row.original);
                                                    setDetailMode('info');
                                                }}
                                                className={`transition-colors cursor-pointer ${isSelected
                                                    ? 'bg-emerald-50 border-l-4 border-l-emerald-500'
                                                    : 'hover:bg-slate-50/80'
                                                    }`}
                                            >
                                                {row.getVisibleCells().map((cell, idx) => (
                                                    <td
                                                        key={cell.id}
                                                        className={`px-4 py-2.5 align-middle ${idx === 2 ? 'sticky left-0 z-[5] bg-inherit shadow-[2px_0_6px_-2px_rgba(0,0,0,0.05)]' : ''}`}
                                                    >
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {!loading && totalProducts > 0 && (
                        <div className="flex-shrink-0 px-4 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between">
                            <p className="text-[11px] text-slate-500">
                                {pageStart}–{pageEnd} dari {totalProducts}
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage <= 1}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 hover:bg-slate-50 min-h-0 min-w-0"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="px-3 py-1 text-xs font-bold text-slate-700">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage >= totalPages}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 hover:bg-slate-50 min-h-0 min-w-0"
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Detail Panel (Right) — Desktop only inline, Mobile modal */}
                {selectedProduct && (
                    <>
                        {/* Desktop: side panel */}
                        <div className="hidden md:block w-[40%] max-w-[480px] border-l border-slate-200 overflow-hidden">
                            <WarehouseDetailPanel
                                product={selectedProduct}
                                categories={categories}
                                onClose={() => setSelectedProduct(null)}
                                onProductUpdated={handleProductUpdated}
                                mode={detailMode}
                                onRequestEdit={() => {
                                    setIsEditMode(true);
                                    setDetailMode('edit');
                                }}
                            />
                        </div>
                        {/* Mobile: slide-up modal */}
                        <div className="md:hidden fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-end">
                            <div className="w-full max-h-[85vh] bg-white rounded-t-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
                                <WarehouseDetailPanel
                                    product={selectedProduct}
                                    categories={categories}
                                    onClose={() => setSelectedProduct(null)}
                                    onProductUpdated={handleProductUpdated}
                                    mode={detailMode}
                                    onRequestEdit={() => {
                                        setIsEditMode(true);
                                        setDetailMode('edit');
                                    }}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div >
    );
}
