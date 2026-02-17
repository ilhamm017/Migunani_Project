'use client';

import { useCallback, useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import {
    RotateCcw,
    CheckCircle,
    User as UserIcon,
    Calendar,
    ArrowLeft,
    HandCoins,
    Clock,
    ChevronRight,
    Truck
} from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function FinanceReturPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [returs, setReturs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.retur.getAll();
            const relevant = (res.data || []).filter((r: any) =>
                ['approved', 'pickup_assigned', 'picked_up', 'handed_to_warehouse', 'received', 'completed'].includes(r.status)
            );
            setReturs(relevant);
        } catch (error) {
            console.error('Failed to load returs for finance:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (allowed) {
            void loadData();
        }
    }, [allowed, loadData]);

    useRealtimeRefresh({
        enabled: allowed,
        onRefresh: loadData,
        domains: ['retur', 'order', 'cod', 'admin'],
        pollIntervalMs: 10000,
    });

    if (!allowed) return null;

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Link href="/admin/finance" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors">
                    <ArrowLeft size={20} />
                </Link>
                <div>
                    <h1 className="text-2xl font-black text-slate-900">Refund Retur Pelanggan</h1>
                    <p className="text-sm text-slate-500">Daftar pengembalian dana yang harus diproses.</p>
                </div>
                <Link
                    href="/admin/finance/credit-note"
                    className="ml-auto px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800"
                >
                    Credit Note
                </Link>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-100 rounded-[32px] animate-pulse" />)}
                </div>
            ) : returs.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-[48px] p-20 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <HandCoins size={32} className="text-slate-300" />
                    </div>
                    <p className="text-slate-400 font-bold">Tidak ada antrian refund retur.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {returs.map((r) => {
                        const hasDisbursed = Boolean(r.refund_disbursed_at);
                        return (
                        <Link
                            key={r.id}
                            href={`/admin/finance/retur/${r.id}`}
                            className="block bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${r.status === 'completed' ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                                            {r.status === 'completed' ? 'Retur Selesai' : 'Sedang Diproses'}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">Order #{r.order_id.slice(0, 8)}</span>
                                    </div>
                                    <h3 className="font-black text-slate-900 line-clamp-1">{r.Product?.name}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="text-right">
                                        <p className="text-[10px] font-black text-slate-400 uppercase">Estimasi Refund</p>
                                        <p className="text-lg font-black text-emerald-600">{formatCurrency(r.refund_amount || 0)}</p>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 border-y border-slate-100 mb-4 text-[11px] text-slate-500">
                                <div className="flex items-center gap-1.5">
                                    <UserIcon size={14} className="text-slate-400" />
                                    <span className="font-bold">{r.Creator?.name}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Calendar size={14} className="text-slate-400" />
                                    <span>{formatDateTime(r.createdAt)}</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const creatorId = String(r?.Creator?.id || '').trim();
                                        const targetPhone = String(r?.Creator?.whatsapp_number || '').trim();
                                        if (creatorId) {
                                            router.push(`/admin/chat?userId=${encodeURIComponent(creatorId)}`);
                                            return;
                                        }
                                        if (targetPhone) {
                                            router.push(`/admin/chat?phone=${encodeURIComponent(targetPhone)}`);
                                            return;
                                        }
                                        router.push('/admin/chat');
                                    }}
                                    className="flex-1 text-center py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
                                >
                                    Hubungi Customer (Chat App)
                                </button>
                                {hasDisbursed ? (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700">
                                        <CheckCircle size={14} />
                                        <span className="text-[9px] font-black uppercase">Dana Sudah Dicairkan</span>
                                    </div>
                                ) : (
                                    <>
                                        {r.status === 'approved' && (
                                            <div className="flex items-center gap-1 text-slate-400">
                                                <Clock size={14} />
                                                <span className="text-[9px] font-black uppercase">Menunggu Kasir</span>
                                            </div>
                                        )}
                                        {r.status === 'pickup_assigned' && (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 animate-pulse">
                                                <HandCoins size={16} />
                                                <div className="leading-tight">
                                                    <p className="text-[10px] font-black uppercase">Segera Cairkan</p>
                                                    <p className="text-[8px] font-bold opacity-70">Uang Jalan & Refund</p>
                                                </div>
                                            </div>
                                        )}
                                        {r.status === 'picked_up' && (
                                            <div className="flex items-center gap-1 text-amber-600">
                                                <Truck size={14} />
                                                <span className="text-[9px] font-black uppercase">Sudah Dipickup</span>
                                            </div>
                                        )}
                                        {r.status === 'handed_to_warehouse' && (
                                            <div className="flex items-center gap-1 text-violet-600">
                                                <RotateCcw size={14} />
                                                <span className="text-[9px] font-black uppercase">Menunggu ACC Kasir</span>
                                            </div>
                                        )}
                                        {r.status === 'received' && (
                                            <div className="flex items-center gap-1 text-amber-600">
                                                <RotateCcw size={14} />
                                                <span className="text-[9px] font-black uppercase">Barang Tiba</span>
                                            </div>
                                        )}
                                        {r.status === 'completed' && (
                                            <div className="flex items-center gap-1 text-emerald-600 font-black">
                                                <CheckCircle size={14} />
                                                <span className="text-[9px] uppercase">Selesai</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
