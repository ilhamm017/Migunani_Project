'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import Link from 'next/link';

export default function CashFlowPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const [startDate, setStartDate] = useState(firstDay);
    const [endDate, setEndDate] = useState(lastDay);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getCashFlow({ startDate, endDate });
            setData(res.data);
        } catch (e) {
            console.error(e);
            alert('Gagal memuat laporan');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (allowed) load();
    }, [allowed]);

    if (!allowed) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-10">
            <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
                <div className="flex items-center gap-3 mb-4">
                    <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <ArrowLeft size={20} className="text-slate-700" />
                    </Link>
                    <h1 className="font-bold text-lg text-slate-900">Arus Kas (Cash Flow)</h1>
                </div>

                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                    <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="flex-1 bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
                    />
                    <span className="self-center text-slate-400 font-bold">-</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="flex-1 bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
                    />
                    <button
                        onClick={load}
                        className="bg-slate-900 text-white px-4 rounded-lg text-xs font-bold"
                    >
                        Go
                    </button>
                </div>
            </div>

            <div className="p-5 space-y-4">
                {loading ? (
                    <div className="text-center py-10 text-slate-400">Loading...</div>
                ) : data ? (
                    <div className="space-y-4">

                        {/* Closing Balance Card */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Saldo Akhir</p>
                            <p className="text-3xl font-black text-slate-900">
                                {formatCurrency(data.closing_balance)}
                            </p>
                            <div className="mt-3 text-xs text-slate-400">
                                Saldo Awal: <span className="font-bold text-slate-600">{formatCurrency(data.opening_balance)}</span>
                            </div>
                        </div>

                        {/* Flow Summary */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                <div className="flex items-center gap-2 mb-2 text-emerald-600">
                                    <ArrowDownCircle size={20} />
                                    <span className="text-xs font-bold uppercase">Uang Masuk</span>
                                </div>
                                <p className="font-bold text-lg text-emerald-700">{formatCurrency(data.cash_in)}</p>
                            </div>
                            <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100">
                                <div className="flex items-center gap-2 mb-2 text-rose-600">
                                    <ArrowUpCircle size={20} />
                                    <span className="text-xs font-bold uppercase">Uang Keluar</span>
                                </div>
                                <p className="font-bold text-lg text-rose-700">{formatCurrency(data.cash_out)}</p>
                            </div>
                        </div>

                        {/* Net Change */}
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Perubahan Bersih (Net Change)</span>
                            <span className={`font-black ${data.net_change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {data.net_change > 0 ? '+' : ''}{formatCurrency(data.net_change)}
                            </span>
                        </div>

                    </div>
                ) : null}
            </div>
        </div>
    );
}
