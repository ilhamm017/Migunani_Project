'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Camera, CheckCircle, MapPin, Package, RefreshCw, Loader2 } from 'lucide-react';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

interface PickItem {
    id: string;
    orderId: string;
    orderNumber: string;
    productId: string;
    productName: string;
    productSku: string;
    productImage: string | null;
    binLocation: string;
    qtyRequired: number;
    picked: boolean;
}

export default function WarehouseHelperPage() {
    const [items, setItems] = useState<PickItem[]>([]);
    const [orders, setOrders] = useState<any[]>([]); // Added state for orders
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState<string | null>(null);

    const loadPickingItems = useCallback(async () => {
        try {
            setLoading(true);
            // Fetch processing orders that need picking
            const res = await api.admin.orderManagement.getAll({ status: 'processing', limit: 20 });
            const fetchedOrders = res.data?.orders || [];
            setOrders(fetchedOrders); // Set the fetched orders to state

            const pickItems: PickItem[] = [];
            for (const order of fetchedOrders) { // Use fetchedOrders here
                const orderItems = order.OrderItems || [];
                for (const item of orderItems) {
                    pickItems.push({
                        id: `${order.id}-${item.product_id || item.id}`,
                        orderId: order.id,
                        orderNumber: order.order_number || order.id?.slice(0, 8),
                        productId: item.product_id || item.id,
                        productName: item.Product?.name || item.product_name || 'Produk',
                        productSku: item.Product?.sku || item.sku || '',
                        productImage: item.Product?.image_url || null,
                        binLocation: item.Product?.bin_location || '—',
                        qtyRequired: Number(item.qty || item.quantity || 1),
                        picked: false,
                    });
                }
            }

            setItems(pickItems);
        } catch {
            // Silent
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPickingItems();
    }, [loadPickingItems]);

    useRealtimeRefresh({
        enabled: true,
        onRefresh: loadPickingItems,
        domains: ['order', 'admin'],
        pollIntervalMs: 15000,
    });

    const confirmPick = async (pickItem: PickItem) => {
        setConfirming(pickItem.id);
        // Mark as picked locally
        setTimeout(() => {
            setItems(prev => prev.map(item =>
                item.id === pickItem.id ? { ...item, picked: true } : item
            ));
            setConfirming(null);
        }, 500);
    };

    const unconfirmPick = (pickItem: PickItem) => {
        setItems(prev => prev.map(item =>
            item.id === pickItem.id ? { ...item, picked: false } : item
        ));
    };

    const unpickedItems = items.filter(i => !i.picked);
    const pickedItems = items.filter(i => i.picked);

    return (
        <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden bg-slate-50">
            {/* Breadcrumbs & Title */}
            <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-1 border-b border-slate-200">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="warehouse-title">Picking List</h1>
                        <p className="warehouse-subtitle">
                            {unpickedItems.length} item perlu diambil • {pickedItems.length} selesai
                        </p>
                    </div>
                    <button
                        onClick={() => void loadPickingItems()}
                        disabled={loading}
                        className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                        title="Refresh List"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                        <Loader2 size={32} className="animate-spin mb-3" />
                        <p className="text-sm font-medium">Memuat daftar picking...</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                        <Package size={48} className="mb-3 opacity-40" />
                        <p className="text-base font-bold text-slate-500">Tidak Ada Picking</p>
                        <p className="text-sm text-slate-400 mt-1">Semua order sudah disiapkan.</p>
                    </div>
                ) : (
                    <>
                        {/* Unpicked Items */}
                        {unpickedItems.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider px-1">
                                    Perlu Diambil ({unpickedItems.length})
                                </h3>
                                {unpickedItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                                    >
                                        <div className="flex items-center gap-4 p-4">
                                            {/* Thumbnail */}
                                            <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 flex-shrink-0 overflow-hidden">
                                                {item.productImage ? (
                                                    <img src={item.productImage} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                        <Camera size={24} />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Product Info */}
                                            <div className="flex-1 min-w-0">
                                                {/* Bin Location - EXTRA LARGE */}
                                                <div className="flex items-center gap-2 mb-1">
                                                    <MapPin size={18} className="text-emerald-600 flex-shrink-0" />
                                                    <span className="text-2xl font-black text-emerald-700 font-mono leading-none">
                                                        {item.binLocation}
                                                    </span>
                                                </div>

                                                {/* Product Name */}
                                                <p className="text-sm font-bold text-slate-800 truncate mt-1">
                                                    {item.productName}
                                                </p>

                                                {/* Meta */}
                                                <div className="flex items-center gap-3 mt-1.5">
                                                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                        {item.productSku}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400">
                                                        Order #{item.orderNumber?.slice(-6)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Quantity Badge */}
                                            <div className="flex-shrink-0 text-center">
                                                <div className="w-14 h-14 rounded-xl bg-slate-900 flex items-center justify-center">
                                                    <span className="text-xl font-black text-white">{item.qtyRequired}</span>
                                                </div>
                                                <span className="text-[9px] text-slate-500 font-bold uppercase mt-1 block">pcs</span>
                                            </div>
                                        </div>

                                        {/* Confirm Button - EXTRA LARGE */}
                                        <button
                                            onClick={() => confirmPick(item)}
                                            disabled={!!confirming}
                                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-base flex items-center justify-center gap-2 transition-colors min-h-[56px]"
                                        >
                                            {confirming === item.id ? (
                                                <Loader2 size={20} className="animate-spin" />
                                            ) : (
                                                <CheckCircle size={20} />
                                            )}
                                            {confirming === item.id ? 'Mengkonfirmasi...' : 'Konfirmasi Ambil'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Picked Items */}
                        {pickedItems.length > 0 && (
                            <div className="space-y-2 mt-6">
                                <h3 className="text-xs font-black uppercase text-emerald-600 tracking-wider px-1">
                                    ✓ Sudah Diambil ({pickedItems.length})
                                </h3>
                                {pickedItems.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => unconfirmPick(item)}
                                        className="bg-emerald-50 rounded-xl border border-emerald-200 p-3 flex items-center gap-3 opacity-70 cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                            <CheckCircle size={20} className="text-emerald-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-emerald-800 truncate line-through">{item.productName}</p>
                                            <p className="text-xs text-emerald-600 font-mono">
                                                {item.binLocation} • {item.qtyRequired} pcs
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
