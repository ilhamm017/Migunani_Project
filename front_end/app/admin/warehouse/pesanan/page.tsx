'use client';

import { useEffect, useState, useCallback, useRef, DragEvent } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Package, Clock, User, Hash, GripVertical, RefreshCw } from 'lucide-react';

interface OrderCard {
    id: string;
    order_number: string;
    customer_name: string;
    total_amount: number;
    item_count: number;
    status: string;
    created_at: string;
    payment_method?: string;
}

interface KanbanColumn {
    key: string;
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    headerBg: string;
    dotColor: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
    {
        key: 'pending',
        label: 'pending (Pesanan Masuk)',
        color: 'text-blue-700',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        headerBg: 'bg-blue-100',
        dotColor: 'bg-blue-500',
    },
    {
        key: 'waiting_payment',
        label: 'waiting_payment (Menunggu Bayar)',
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
        headerBg: 'bg-amber-100',
        dotColor: 'bg-amber-500',
    },
    {
        key: 'processing',
        label: 'processing (Sedang Disiapkan)',
        color: 'text-purple-700',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
        headerBg: 'bg-purple-100',
        dotColor: 'bg-purple-500',
    },
    {
        key: 'shipped',
        label: 'shipped (Siap Kirim)',
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-200',
        headerBg: 'bg-emerald-100',
        dotColor: 'bg-emerald-500',
    },
];

// Map kanban column keys to API statuses
const STATUS_MAP_TO_API: Record<string, string> = {
    pending: 'pending',
    waiting_payment: 'waiting_payment',
    processing: 'processing',
    shipped: 'shipped',
};

export default function WarehouseKanbanPage() {
    const [orders, setOrders] = useState<OrderCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [draggedOrder, setDraggedOrder] = useState<string | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

    const loadOrders = useCallback(async () => {
        try {
            setLoading(true);
            // Fetch orders for each relevant status
            const statuses = ['pending', 'waiting_payment', 'processing', 'shipped'];
            const results = await Promise.all(
                statuses.map(status =>
                    api.admin.orderManagement.getAll({ status, limit: 50 })
                        .then(res => res.data?.orders || [])
                        .catch(() => [])
                )
            );

            const allOrders: OrderCard[] = results.flat().map((o: any) => ({
                id: o.id,
                order_number: o.order_number || o.id?.slice(0, 8),
                customer_name: o.User?.name || o.customer_name || 'Customer',
                total_amount: Number(o.total_amount || 0),
                item_count: o.OrderItems?.length || o.item_count || 0,
                status: o.status,
                created_at: o.createdAt || o.created_at,
                payment_method: o.payment_method,
            }));

            setOrders(allOrders);
            setLastRefresh(new Date());
        } catch {
            // Silent fail
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadOrders();
        // Auto-refresh every 30 seconds
        refreshTimerRef.current = setInterval(() => { void loadOrders(); }, 30000);
        return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
    }, [loadOrders]);

    // Categorize orders by kanban column
    const getColumnOrders = useCallback((columnKey: string): OrderCard[] => {
        // Map processing orders: if they were moved to "packing", tag them differently
        // For now, we split processing into picking and packing via a simple heuristic
        // In production, you'd have sub-statuses. Here we use the status field directly.
        return orders.filter(o => o.status === columnKey);
    }, [orders]);

    // Drag handlers
    const onDragStart = (e: DragEvent, orderId: string) => {
        e.dataTransfer.setData('text/plain', orderId);
        e.dataTransfer.effectAllowed = 'move';
        setDraggedOrder(orderId);
    };

    const onDragOver = (e: DragEvent, columnKey: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverColumn(columnKey);
    };

    const onDragLeave = () => {
        setDragOverColumn(null);
    };

    const onDrop = async (e: DragEvent, targetColumn: string) => {
        e.preventDefault();
        setDragOverColumn(null);
        const orderId = e.dataTransfer.getData('text/plain');
        if (!orderId) return;

        const order = orders.find(o => o.id === orderId);
        if (!order || order.status === targetColumn) {
            setDraggedOrder(null);
            return;
        }

        // Optimistic update
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: targetColumn } : o));
        setDraggedOrder(null);
        setUpdating(orderId);

        try {
            const apiStatus = STATUS_MAP_TO_API[targetColumn] || targetColumn;
            await api.admin.orderManagement.updateStatus(orderId, { status: apiStatus });
            alert(`Status berhasil diupdate ke: ${targetColumn === 'shipped' ? 'Dikirim' : 'Siap Dikirim'}`);
            void loadOrders();
        } catch (error) {
            alert('Gagal update status.');
        } finally {
            setUpdating(null);
        }
    };

    const onDragEnd = () => {
        setDraggedOrder(null);
        setDragOverColumn(null);
    };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);

    const timeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) return `${minutes}m lalu`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}j lalu`;
        return `${Math.floor(hours / 24)}h lalu`;
    };

    return (
        <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden">
            {/* Breadcrumbs & Title */}
            <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-1">
                <div className="warehouse-breadcrumb mb-0">
                    <Link href="/admin" className="hover:text-emerald-500 transition-colors">Warehouse</Link>
                    <span>/</span>
                    <span className="text-slate-900">Kanban Board</span>
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="warehouse-title">Monitor Pesanan</h1>
                        <p className="warehouse-subtitle">Gunakan drag & drop kartu pesanan antar kolom untuk transisi status pengerjaan.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end mr-3">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Terakhir Sinkron</span>
                            <span className="text-xs font-bold text-slate-600">
                                {lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        </div>
                        <button
                            onClick={() => void loadOrders()}
                            disabled={loading}
                            className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                            title="Refresh Data"
                        >
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
                <div className="flex gap-4 h-full min-w-max">
                    {KANBAN_COLUMNS.map((col) => {
                        const columnOrders = getColumnOrders(col.key);
                        const isDragOver = dragOverColumn === col.key;

                        return (
                            <div
                                key={col.key}
                                className={`w-[300px] flex flex-col rounded-2xl border transition-all duration-200 ${isDragOver
                                    ? `${col.borderColor} ${col.bgColor} shadow-lg scale-[1.02]`
                                    : 'border-slate-200 bg-slate-50/50'
                                    }`}
                                onDragOver={(e) => onDragOver(e, col.key)}
                                onDragLeave={onDragLeave}
                                onDrop={(e) => onDrop(e, col.key)}
                            >
                                {/* Column Header */}
                                <div className={`flex items-center justify-between px-4 py-3 rounded-t-2xl ${col.headerBg}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                                        <span className={`text-xs font-black uppercase tracking-wide ${col.color}`}>
                                            {col.label}
                                        </span>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${col.bgColor} ${col.color} border ${col.borderColor}`}>
                                        {columnOrders.length}
                                    </span>
                                </div>

                                {/* Cards Container */}
                                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                                    {loading ? (
                                        <div className="flex items-center justify-center py-8 text-slate-400">
                                            <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                    ) : columnOrders.length === 0 ? (
                                        <div className="text-center py-8 text-slate-400">
                                            <Package size={24} className="mx-auto mb-2 opacity-40" />
                                            <p className="text-[11px] font-medium">Tidak ada pesanan</p>
                                        </div>
                                    ) : (
                                        columnOrders.map((order) => (
                                            <div
                                                key={order.id}
                                                draggable
                                                onDragStart={(e) => onDragStart(e, order.id)}
                                                onDragEnd={onDragEnd}
                                                className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm cursor-grab active:cursor-grabbing transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 ${draggedOrder === order.id ? 'opacity-40 scale-95' : ''
                                                    } ${updating === order.id ? 'animate-pulse' : ''}`}
                                            >
                                                {/* Card Header */}
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <GripVertical size={12} className="text-slate-300" />
                                                        <span className="font-mono text-[11px] font-bold text-slate-600">
                                                            #{order.order_number?.slice(-6) || order.id.slice(0, 6)}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                        <Clock size={10} />
                                                        {timeAgo(order.created_at)}
                                                    </span>
                                                </div>

                                                {/* Customer */}
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <User size={12} className="text-slate-400" />
                                                    <span className="text-xs font-bold text-slate-800 truncate">{order.customer_name}</span>
                                                </div>

                                                {/* Footer */}
                                                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                                    <div className="flex items-center gap-1">
                                                        <Hash size={10} className="text-slate-400" />
                                                        <span className="text-[10px] text-slate-500">{order.item_count} item</span>
                                                    </div>
                                                    <span className="text-xs font-bold text-slate-900">
                                                        {formatCurrency(order.total_amount)}
                                                    </span>
                                                </div>

                                                {/* Payment Badge */}
                                                {order.payment_method && (
                                                    <div className="mt-2">
                                                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${order.payment_method === 'cod'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {order.payment_method.replace('_', ' ')}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
