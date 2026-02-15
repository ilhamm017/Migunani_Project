'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

const ALLOCATION_EDITABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;
type AllocationEditableStatus = typeof ALLOCATION_EDITABLE_STATUSES[number];
const isAllocationEditableStatus = (status: string): status is AllocationEditableStatus =>
    ALLOCATION_EDITABLE_STATUSES.includes(status as AllocationEditableStatus);

export default function AllocationDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [allocations, setAllocations] = useState<{ [key: string]: number }>({});
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [canceling, setCanceling] = useState(false);

    const groupedItems = useMemo(() => {
        if (!order?.OrderItems) return [];
        const byProduct = new Map<string, any>();

        order.OrderItems.forEach((item: any) => {
            const productId = String(item.product_id || '');
            if (!productId) return;

            const prev = byProduct.get(productId);
            if (prev) {
                prev.qty += Number(item.qty || 0);
                return;
            }

            byProduct.set(productId, {
                product_id: productId,
                qty: Number(item.qty || 0),
                Product: item.Product,
            });
        });

        return Array.from(byProduct.values());
    }, [order]);

    const persistedAllocByProduct = useMemo(() => {
        const map: { [key: string]: number } = {};
        (order?.Allocations || []).forEach((allocation: any) => {
            const key = String(allocation?.product_id || '');
            if (!key) return;
            map[key] = Number(map[key] || 0) + Number(allocation?.allocated_qty || 0);
        });
        return map;
    }, [order]);

    const orderedByProduct = useMemo(() => {
        const map: { [key: string]: number } = {};
        groupedItems.forEach((item: any) => {
            map[item.product_id] = Number(map[item.product_id] || 0) + Number(item.qty || 0);
        });
        return map;
    }, [groupedItems]);

    const persistedShortageTotal = useMemo(() => {
        return Object.entries(orderedByProduct).reduce((sum, [productId, orderedQty]) => {
            const allocatedQty = Number(persistedAllocByProduct[productId] || 0);
            return sum + Math.max(0, Number(orderedQty || 0) - allocatedQty);
        }, 0);
    }, [orderedByProduct, persistedAllocByProduct]);

    const draftShortageTotal = useMemo(() => {
        return Object.entries(orderedByProduct).reduce((sum, [productId, orderedQty]) => {
            const allocatedQty = Number(allocations[productId] || 0);
            return sum + Math.max(0, Number(orderedQty || 0) - allocatedQty);
        }, 0);
    }, [orderedByProduct, allocations]);

    const allocationUpdatedAt = useMemo(() => {
        const timestamps = (order?.Allocations || [])
            .map((item: any) => new Date(item.updatedAt || item.createdAt || 0).getTime())
            .filter((value: number) => Number.isFinite(value) && value > 0);
        if (!timestamps.length) return null;
        return new Date(Math.max(...timestamps));
    }, [order]);

    const timelineItems = useMemo(() => {
        if (!order) return [];
        const rows = [
            {
                key: 'created',
                label: 'Order dibuat',
                detail: `Status awal: ${order.status}`,
                at: new Date(order.createdAt),
                tone: 'slate',
            }
        ];

        if (allocationUpdatedAt) {
            rows.push({
                key: 'allocation_update',
                label: 'Alokasi terakhir diperbarui',
                detail: 'Data alokasi sudah pernah diproses.',
                at: allocationUpdatedAt,
                tone: 'blue',
            });
        }

        if (persistedShortageTotal > 0) {
            rows.push({
                key: 'partial',
                label: 'Alokasi parsial aktif',
                detail: `Masih kurang ${persistedShortageTotal} item, order tetap dipantau sebagai pre-order/backorder.`,
                at: allocationUpdatedAt || new Date(order.updatedAt || order.createdAt),
                tone: 'amber',
            });
        } else {
            rows.push({
                key: 'full',
                label: 'Alokasi terpenuhi',
                detail: 'Semua item sudah teralokasi.',
                at: allocationUpdatedAt || new Date(order.updatedAt || order.createdAt),
                tone: 'emerald',
            });
        }

        return rows;
    }, [order, allocationUpdatedAt, persistedShortageTotal]);

    useEffect(() => {
        if (id) loadData();
    }, [id]);

    const loadData = async () => {
        try {
            const res = await api.allocation.getDetail(id as string);
            setOrder(res.data);

            // Initialize allocations aggregated by product
            const persistedAllocMap: { [key: string]: number } = {};
            (res.data.Allocations || []).forEach((allocation: any) => {
                const key = String(allocation?.product_id || '');
                if (!key) return;
                persistedAllocMap[key] = Number(persistedAllocMap[key] || 0) + Number(allocation?.allocated_qty || 0);
            });

            const orderedProductMap: { [key: string]: number } = {};
            (res.data.OrderItems || []).forEach((item: any) => {
                const key = String(item?.product_id || '');
                if (!key) return;
                orderedProductMap[key] = Number(orderedProductMap[key] || 0) + Number(item?.qty || 0);
            });

            const initialAlloc: { [key: string]: number } = {};
            Object.keys(orderedProductMap).forEach((productId) => {
                initialAlloc[productId] = Number(persistedAllocMap[productId] || 0);
            });
            setAllocations(initialAlloc);

        } catch (error) {
            console.error('Failed to load order detail', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAutoAllocate = () => {
        if (!order) return;
        if (!isAllocationEditableStatus(String(order.status || ''))) {
            alert(`Alokasi dikunci pada status '${order.status}'.`);
            return;
        }
        const newAlloc: { [key: string]: number } = {};

        groupedItems.forEach((item: any) => {
            const product = item.Product || {};
            const currentAllocated = Number(persistedAllocByProduct[item.product_id] || 0);

            // stock_quantity is already net of allocations (reduced during allocateOrder)
            // So available for this order = current physical stock + what's already allocated to THIS order
            const maxAvailable = Number(product.stock_quantity || 0) + currentAllocated;

            // Allocate min(Requested, MaxAvailable)
            newAlloc[item.product_id] = Math.min(item.qty, Math.max(0, maxAvailable));
        });
        setAllocations(newAlloc);
    };

    const handleSubmit = async () => {
        if (!isAllocationEditableStatus(String(order?.status || ''))) {
            alert(`Alokasi tidak dapat diubah pada status '${order?.status}'.`);
            return;
        }
        try {
            const items = Object.entries(allocations).map(([product_id, qty]) => ({
                product_id,
                qty
            }));

            await api.allocation.allocate(id as string, items);
            alert('Alokasi berhasil disimpan!');
            router.push('/admin/warehouse/allocation');
        } catch (error) {
            alert('Gagal menyimpan alokasi');
        }
    };

    const isAllocationEditable = isAllocationEditableStatus(String(order?.status || ''));
    const canCancelBackorder = persistedShortageTotal > 0 && ['pending', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'].includes(String(order?.status || ''));

    const handleCancelBackorder = async () => {
        const reason = cancelReason.trim();
        if (reason.length < 5) {
            alert('Alasan cancel minimal 5 karakter.');
            return;
        }

        setCanceling(true);
        try {
            await api.allocation.cancelBackorder(id as string, reason);
            alert('Backorder / pre-order berhasil dibatalkan.');
            setShowCancelDialog(false);
            setCancelReason('');
            router.push('/admin/warehouse/allocation');
        } catch (error: any) {
            const message = error?.response?.data?.message || 'Gagal membatalkan backorder / pre-order.';
            alert(message);
        } finally {
            setCanceling(false);
        }
    };

    if (loading) return <div className="p-6">Loading...</div>;
    if (!order) return <div className="p-6">Order not found</div>;

    return (
        <div className="warehouse-page">
            <div>
                <div className="warehouse-breadcrumb">
                    <Link href="/admin" className="hover:text-emerald-500 transition-colors">Warehouse</Link>
                    <span>/</span>
                    <Link href="/admin/warehouse/allocation" className="hover:text-emerald-500 transition-colors">Order Allocation</Link>
                    <span>/</span>
                    <span className="text-slate-900">Proses</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/warehouse/allocation" className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
                            <ArrowLeft size={18} className="text-slate-700" />
                        </Link>
                        <div>
                            <h1 className="warehouse-title">Proses Alokasi Stok</h1>
                            <p className="warehouse-subtitle">Order <span className="font-mono text-xs text-slate-400">#{order.id.substring(0, 8)}</span> • Customer: <span className="font-bold text-slate-700">{order.Customer?.name || 'Guest'}</span></p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        {canCancelBackorder && (
                            <button
                                onClick={() => setShowCancelDialog(true)}
                                className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl transition-colors border border-rose-200"
                            >
                                Cancel Backorder
                            </button>
                        )}
                        <button
                            onClick={handleAutoAllocate}
                            disabled={!isAllocationEditable}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Auto Fill
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!isAllocationEditable}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Check size={18} />
                            Simpan Alokasi
                        </button>
                    </div>
                </div>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                {!isAllocationEditable && (
                    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs font-bold text-amber-800">
                        Mode lihat saja: order status <span className="font-black">{order.status}</span>. Alokasi dikunci untuk mencegah rollback proses invoice/pembayaran.
                    </div>
                )}
                <div className="border-b border-slate-200 px-6 py-4 bg-slate-50/60">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700">Item SKU: {groupedItems.length}</span>
                        <span className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700">Kurang (tersimpan): {persistedShortageTotal}</span>
                        <span className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700">Kurang (draft): {draftShortageTotal}</span>
                    </div>
                </div>
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4 font-bold text-slate-700">Produk</th>
                            <th className="px-6 py-4 font-bold text-slate-700 text-center">Permintaan</th>
                            <th className="px-6 py-4 font-bold text-slate-700 text-center">Stok Gudang</th>
                            <th className="px-6 py-4 font-bold text-slate-700 text-center">Tersedia</th>
                            <th className="px-6 py-4 font-bold text-slate-700 text-center w-32">Alokasi</th>
                            <th className="px-6 py-4 font-bold text-slate-700">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {groupedItems.map((item: any) => {
                            const product = item.Product || {};
                            const currentAllocated = Number(persistedAllocByProduct[item.product_id] || 0);
                            // stock_quantity is net of allocations; available for this order = stock + what's already allocated here
                            const maxAvailable = Number(product.stock_quantity || 0) + currentAllocated;

                            const allocated = allocations[item.product_id] ?? 0;
                            const isFulfilled = allocated >= item.qty;
                            const isPartial = allocated > 0 && allocated < item.qty;

                            return (
                                <tr key={item.product_id} className="hover:bg-slate-50">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">{product.name || 'Produk'}</div>
                                        <div className="text-xs text-slate-500">{product.sku || item.product_id}</div>
                                    </td>
                                    <td className="px-6 py-4 text-center font-bold text-slate-700">
                                        {item.qty}
                                    </td>
                                    <td className="px-6 py-4 text-center font-mono text-slate-500">
                                        {product.stock_quantity}
                                    </td>
                                    <td className="px-6 py-4 text-center font-mono font-bold text-emerald-600">
                                        {maxAvailable}
                                    </td>
                                    <td className="px-6 py-4">
                                        <input
                                            type="number"
                                            min="0"
                                            max={Math.min(item.qty, maxAvailable)}
                                            value={allocated}
                                            disabled={!isAllocationEditable}
                                            onChange={(e) => {
                                                const val = Math.min(parseInt(e.target.value) || 0, maxAvailable, item.qty);
                                                setAllocations(prev => ({ ...prev, [item.product_id]: val }));
                                            }}
                                            className="w-full px-3 py-1 border border-slate-300 rounded-lg text-center font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all disabled:bg-slate-100 disabled:text-slate-500"
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        {isFulfilled ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold">
                                                <Check size={14} /> Penuh
                                            </span>
                                        ) : isPartial ? (
                                            <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold">
                                                <AlertTriangle size={14} /> Parsial
                                            </span>
                                        ) : (
                                            <span className="text-rose-500 text-xs font-bold">Kosong</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="warehouse-panel bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <h2 className="text-base font-black text-slate-900">Timeline Alokasi</h2>
                <div className="mt-4 space-y-3">
                    {timelineItems.map((event: any) => (
                        <div key={event.key} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm font-black ${event.tone === 'amber' ? 'text-amber-700' : event.tone === 'emerald' ? 'text-emerald-700' : event.tone === 'blue' ? 'text-blue-700' : 'text-slate-900'}`}>
                                    {event.label}
                                </p>
                                <span className="text-[11px] font-semibold text-slate-500">
                                    {new Date(event.at).toLocaleString('id-ID')}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{event.detail}</p>
                        </div>
                    ))}
                </div>
            </div>

            {showCancelDialog && (
                <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl p-5 space-y-4">
                        <div>
                            <h3 className="text-lg font-black text-slate-900">Cancel Backorder / Pre-order</h3>
                            <p className="text-sm text-slate-600 mt-1">
                                Order ini masih kurang alokasi <span className="font-bold text-rose-600">{persistedShortageTotal}</span> item.
                                Masukkan alasan cancel untuk disimpan pada catatan order.
                            </p>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Alasan Cancel</label>
                            <textarea
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                rows={4}
                                placeholder="Contoh: customer tidak ingin menunggu restock / supplier kosong."
                                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => {
                                    if (canceling) return;
                                    setShowCancelDialog(false);
                                    setCancelReason('');
                                }}
                                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleCancelBackorder}
                                disabled={canceling}
                                className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-60"
                            >
                                {canceling ? 'Memproses...' : 'Ya, Cancel Order'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
