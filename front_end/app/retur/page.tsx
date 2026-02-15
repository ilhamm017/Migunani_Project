'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    RotateCcw,
    ArrowLeft,
    Clock,
    CheckCircle2,
    Truck,
    XCircle,
    PackageSearch,
    ChevronRight,
    Search
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function MyReturnsPage() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const [returs, setReturs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }

        const load = async () => {
            try {
                const res = await api.retur.getMyReturs();
                setReturs(res.data || []);
            } catch (error) {
                console.error('Failed to load returs:', error);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [isAuthenticated]);

    const getStatusVisual = (status: string) => {
        switch (status) {
            case 'pending':
                return { label: 'Menunggu Review', className: 'text-amber-600 bg-amber-50', icon: Clock };
            case 'approved':
                return { label: 'Disetujui', className: 'text-emerald-600 bg-emerald-50', icon: CheckCircle2 };
            case 'pickup_assigned':
                return { label: 'Kurir Sedang Menuju Lokasi', className: 'text-blue-600 bg-blue-50', icon: Truck };
            case 'picked_up':
                return { label: 'Barang Sudah Dipickup Kurir', className: 'text-amber-600 bg-amber-50', icon: Truck };
            case 'handed_to_warehouse':
                return { label: 'Menunggu ACC Gudang', className: 'text-violet-600 bg-violet-50', icon: RotateCcw };
            case 'received':
                return { label: 'Barang Diterima Gudang', className: 'text-indigo-600 bg-indigo-50', icon: RotateCcw };
            case 'completed':
                return { label: 'Retur Selesai', className: 'text-slate-600 bg-slate-100', icon: CheckCircle2 };
            case 'rejected':
                return { label: 'Retur Ditolak', className: 'text-rose-600 bg-rose-50', icon: XCircle };
            default:
                return { label: status, className: 'text-slate-600 bg-slate-50', icon: Clock };
        }
    };

    if (loading) {
        return (
            <div className="p-6">
                <p className="text-sm text-slate-500">Memuat data retur...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="p-6 text-center py-20">
                <p className="text-sm text-slate-500">Silakan login untuk melihat data retur Anda.</p>
                <Link href="/auth/login" className="mt-4 inline-block text-emerald-600 font-bold">Login Sekarang</Link>
            </div>
        );
    }

    return (
        <div className="p-6 min-h-screen bg-slate-50 pb-24">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/profile" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors">
                    <ArrowLeft size={20} />
                </Link>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Status Retur</h1>
                    <p className="text-[11px] text-slate-500 font-medium">Pantau proses pengembalian barang Anda.</p>
                </div>
            </div>

            {returs.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-[40px] p-12 text-center shadow-sm">
                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <PackageSearch size={40} className="text-slate-200" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900 mb-1">Belum Ada Retur</h2>
                    <p className="text-[11px] text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                        Anda belum pernah mengajukan pengembalian barang.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {returs.map((r) => {
                        const visual = getStatusVisual(r.status);
                        const Icon = visual.icon;

                        return (
                            <Link
                                key={r.id}
                                href={`/orders/${r.order_id}`}
                                className="block bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm hover:border-emerald-200 transition-all group"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${visual.className}`}>
                                            <Icon size={24} />
                                        </div>
                                        <div>
                                            <p className={`text-[10px] font-black uppercase tracking-widest ${visual.className.split(' ')[0]}`}>
                                                {visual.label}
                                            </p>
                                            <h3 className="text-sm font-black text-slate-900 line-clamp-1">{r.Product?.name || 'Produk'}</h3>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-mono text-slate-400">#{r.order_id.slice(0, 8)}</p>
                                        <p className="text-[10px] font-bold text-slate-500">{formatDateTime(r.createdAt)}</p>
                                    </div>
                                </div>

                                <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between mb-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Jumlah Barang</p>
                                        <p className="text-sm font-black text-slate-900">{r.qty} Unit</p>
                                    </div>
                                    <div className="w-px h-8 bg-slate-200" />
                                    <div className="text-right space-y-1">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Status Saat Ini</p>
                                        <p className="text-[11px] font-bold text-slate-700">{visual.label}</p>
                                    </div>
                                </div>

                                {r.admin_response && (
                                    <div className="mb-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl p-3">
                                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider mb-1">Pesan dari Admin:</p>
                                        <p className="text-[11px] text-slate-600 italic leading-relaxed">"{r.admin_response}"</p>
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-emerald-600">
                                    <span className="text-[10px] font-black uppercase tracking-widest">Detail Pesanan</span>
                                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Help Section */}
            <div className="mt-8 bg-slate-900 rounded-[32px] p-8 text-white relative overflow-hidden">
                <div className="relative z-10">
                    <h3 className="text-lg font-black mb-2">Butuh Bantuan?</h3>
                    <p className="text-[11px] text-slate-400 leading-relaxed mb-6 max-w-[200px]">
                        Jika proses retur memakan waktu lebih lama dari biasanya, hubungi CS kami.
                    </p>
                    <a href="https://wa.me/628123456789" target="_blank" className="inline-flex items-center justify-center px-6 py-3 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-colors">
                        Hubungi WhatsApp
                    </a>
                </div>
                <RotateCcw size={140} className="absolute -right-8 -bottom-8 text-white opacity-5" />
            </div>
        </div>
    );
}
