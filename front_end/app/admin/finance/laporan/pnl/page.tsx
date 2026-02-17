'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function PnLPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);

    // Default to current month
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
            const res = await api.admin.finance.getPnL({ startDate, endDate });
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
                    <h1 className="font-bold text-lg text-slate-900">Laba Rugi (P&L)</h1>
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
                        {/* Summary Card */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 text-center">
                            <p className="text-sm text-slate-500 mb-1">Net Profit (Bersih)</p>
                            <p className={`text-3xl font-black ${Number(data.net_profit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatCurrency(data.net_profit)}
                            </p>
                        </div>

                        {/* Breakdown */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                                <h3 className="font-bold text-slate-900">Rincian</h3>
                            </div>
                            <div className="divide-y divide-slate-50">
                                {/* Revenue */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">Pendapatan (Revenue)</p>
                                        <p className="text-[10px] text-slate-400">Total penjualan terbayar</p>
                                    </div>
                                    <span className="font-bold text-emerald-600">{formatCurrency(data.revenue)}</span>
                                </div>

                                {/* COGS */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">HPP (COGS)</p>
                                        <p className="text-[10px] text-slate-400">Modal barang terjual</p>
                                    </div>
                                    <span className="font-bold text-rose-600">({formatCurrency(data.cogs)})</span>
                                </div>

                                {/* Gross Profit */}
                                <div className="p-4 flex justify-between items-center bg-slate-50">
                                    <p className="text-sm font-black text-slate-800">Gross Profit (Kotor)</p>
                                    <span className="font-black text-slate-900">{formatCurrency(data.gross_profit)}</span>
                                </div>

                                {/* Expenses */}
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">Biaya Operasional</p>
                                        <p className="text-[10px] text-slate-400">Gaji, Listrik, Lain-lain</p>
                                    </div>
                                    <span className="font-bold text-rose-600">({formatCurrency(data.expenses)})</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
