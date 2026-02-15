'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    LayoutDashboard, Boxes, ClipboardList, UserCheck,
    Layers, Truck, ShoppingCart, ShieldCheck,
    ScanBarcode, FileSpreadsheet, ClipboardCheck,
    AlertTriangle, Package, TrendingDown, ChevronRight,
    ArrowUpRight, Clock
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function WarehouseLandingPage() {
    const router = useRouter();
    const { user } = useAuthStore();
    const [summary, setSummary] = useState({
        unfulfilled: 0,
        lowStock: 0,
        readyToShip: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.role === 'admin_gudang') {
            router.replace('/admin');
        }
    }, [router, user?.role]);

    useEffect(() => {
        if (user?.role === 'admin_gudang') return;

        const loadStats = async () => {
            try {
                // Fetch stats relevant to warehouse
                const [processingRes, allocatedRes, productsRes] = await Promise.all([
                    api.admin.orderManagement.getAll({ status: 'processing', limit: 1 }),
                    api.admin.orderManagement.getAll({ status: 'allocated', limit: 1 }),
                    api.admin.inventory.getProducts({ limit: 100 }) // Simple check for low stock
                ]);

                const lowStockCount = (productsRes.data?.products || []).filter((p: any) =>
                    Number(p.stock_quantity || 0) <= Number(p.min_stock || 0)
                ).length;

                setSummary({
                    unfulfilled: Number(processingRes.data?.total || 0),
                    readyToShip: Number(allocatedRes.data?.total || 0),
                    lowStock: lowStockCount
                });
            } catch (error) {
                console.error('Failed to load warehouse stats:', error);
            } finally {
                setLoading(false);
            }
        };

        loadStats();
    }, [user?.role]);

    if (user?.role === 'admin_gudang') return null;


    const managementTools = [
        {
            href: '/admin/warehouse/pesanan',
            label: 'Kanban Board',
            desc: 'Monitor status pengerjaan pesanan',
            icon: ClipboardList,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            border: 'border-blue-100'
        },
        {
            href: '/admin/warehouse/helper',
            label: 'Picker Helper',
            desc: 'Daftar ambil barang (Picking List)',
            icon: UserCheck,
            color: 'text-indigo-600',
            bg: 'bg-indigo-50',
            border: 'border-indigo-100'
        },
        {
            href: '/admin/warehouse/inbound',
            label: 'Inbound / PO',
            desc: 'Input stok masuk dari Supplier',
            icon: ShoppingCart,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
            border: 'border-emerald-100'
        },
        {
            href: '/admin/warehouse/audit',
            label: 'Stock Opname',
            desc: 'Audit & penyesuaian fisik stok',
            icon: ShieldCheck,
            color: 'text-rose-600',
            bg: 'bg-rose-50',
            border: 'border-rose-100'
        },
        {
            href: '/admin/warehouse/scanner',
            label: 'Scanner SKU',
            desc: 'Cek detail produk via Barcode',
            icon: ScanBarcode,
            color: 'text-slate-600',
            bg: 'bg-slate-100',
            border: 'border-slate-200'
        },
        {
            href: '/admin/warehouse/categories',
            label: 'Kategori',
            desc: 'Kelola pengelompokan produk',
            icon: Layers,
            color: 'text-sky-600',
            bg: 'bg-sky-50',
            border: 'border-sky-100'
        },
        {
            href: '/admin/warehouse/suppliers',
            label: 'Supplier',
            desc: 'Daftar vendor pemasok barang',
            icon: Truck,
            color: 'text-violet-600',
            bg: 'bg-violet-50',
            border: 'border-violet-100'
        },
        {
            href: '/admin/warehouse/import',
            label: 'Import CSV',
            desc: 'Update data massal via Excel',
            icon: FileSpreadsheet,
            color: 'text-cyan-600',
            bg: 'bg-cyan-50',
            border: 'border-cyan-100'
        },
    ];

    return (
        <div className="warehouse-page space-y-8">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Warehouse Command Center</h1>
                    <p className="text-slate-500 font-medium mt-1">Sistem Manajemen Gudang Advanced — Migunani Motor</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-2xl">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">System Operational</span>
                </div>
            </div>

            {/* Core Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                <StatCard
                    icon={TrendingDown}
                    label="Stok Menipis"
                    value={summary.lowStock}
                    color="rose"
                    loading={loading}
                    href="/admin/warehouse/stok"
                />
                <StatCard
                    icon={Package}
                    label="Proses Picking"
                    value={summary.unfulfilled}
                    color="blue"
                    loading={loading}
                    href="/admin/warehouse/pesanan"
                />
                <StatCard
                    icon={ClipboardCheck}
                    label="Siap Kirim"
                    value={summary.readyToShip}
                    color="emerald"
                    loading={loading}
                    href="/admin/warehouse/pesanan"
                />
            </div>

            {/* Management Tools Grid */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <LayoutDashboard size={20} className="text-emerald-600" />
                        Alat Manajemen Operasional
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {managementTools.map((tool) => {
                        const Icon = tool.icon;
                        return (
                            <Link
                                key={tool.href}
                                href={tool.href}
                                className="warehouse-panel group relative bg-white border border-slate-200 rounded-[24px] p-5 hover:border-emerald-500 hover:shadow-xl hover:shadow-emerald-500/5 transition-all duration-300 overflow-hidden"
                            >
                                <div className="relative z-10 flex items-start gap-4">
                                    <div className={`p-3.5 rounded-2xl ${tool.bg} ${tool.color} group-hover:bg-emerald-600 group-hover:text-white transition-all duration-300 shadow-sm`}>
                                        <Icon size={24} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">{tool.label}</h3>
                                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{tool.desc}</p>
                                    </div>
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 transition-transform">
                                        <ChevronRight size={18} className="text-emerald-500" />
                                    </div>
                                </div>
                                {/* Decorative gradient background */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-50/20 to-transparent rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-500" />
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Secondary Actions */}
            <div className="bg-slate-900 rounded-[32px] p-8 text-white relative overflow-hidden shadow-2xl">
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-2">
                        <h3 className="text-xl font-black">Quick Inventory Access</h3>
                        <p className="text-slate-400 text-sm max-w-md">Buka data grid lengkap untuk melihat seluruh stok barang, harga modal, dan detail teknis lainnya.</p>
                    </div>
                    <Link
                        href="/admin/warehouse/stok"
                        className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-8 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95"
                    >
                        Buka Tabel Inventori
                        <ArrowUpRight size={20} />
                    </Link>
                </div>
                <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, color, loading, href }: any) {
    const colorClasses = {
        orange: 'bg-orange-50 text-orange-600 border-orange-100',
        rose: 'bg-rose-50 text-rose-600 border-rose-100',
        blue: 'bg-blue-50 text-blue-600 border-blue-100',
        emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    } as any;

    return (
        <Link
            href={href}
            className={`warehouse-panel bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm hover:shadow-md transition-all flex items-center gap-4 group`}
        >
            <div className={`p-3.5 rounded-2xl ${colorClasses[color]} group-hover:scale-110 transition-transform`}>
                <Icon size={24} />
            </div>
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                {loading ? (
                    <div className="h-8 w-12 bg-slate-100 animate-pulse rounded-lg mt-1" />
                ) : (
                    <p className="text-2xl font-black text-slate-900 mt-0.5">{value}</p>
                )}
            </div>
        </Link>
    );
}
