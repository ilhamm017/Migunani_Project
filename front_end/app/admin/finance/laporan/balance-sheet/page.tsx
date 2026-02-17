'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function BalanceSheetPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);

    const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getBalanceSheet({ asOfDate });
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
                    <h1 className="font-bold text-lg text-slate-900">Neraca (Balance Sheet)</h1>
                </div>

                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                    <div className="flex-1 flex items-center justify-center px-3 text-xs font-bold text-slate-500">
                        Per Tanggal:
                    </div>
                    <input
                        type="date"
                        value={asOfDate}
                        onChange={e => setAsOfDate(e.target.value)}
                        className="flex-[2] bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
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
                    <div className="space-y-6">

                        {/* Summary Equation */}
                        <div className="bg-emerald-600 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden">
                            <div className="relative z-10 text-center">
                                <p className="text-xs text-emerald-100 mb-1 uppercase tracking-wider font-bold">Total Aset</p>
                                <p className="text-3xl font-black mb-4">{formatCurrency(data.assets)}</p>

                                <div className="flex justify-center gap-8 text-xs font-medium border-t border-emerald-500/50 pt-4">
                                    <div>
                                        <span className="block text-emerald-200 mb-1">Kewajiban</span>
                                        <span className="font-bold text-lg">{formatCurrency(data.liabilities)}</span>
                                    </div>
                                    <div className="text-emerald-300 flex items-center">+</div>
                                    <div>
                                        <span className="block text-emerald-200 mb-1">Ekuitas</span>
                                        <span className="font-bold text-lg">{formatCurrency(data.equity?.total)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Check Balance */}
                        {data.balance_check !== 0 && (
                            <div className="bg-rose-50 text-rose-600 p-3 rounded-xl text-xs font-bold text-center border border-rose-100">
                                ⚠️ Unbalanced: {formatCurrency(data.balance_check)}
                            </div>
                        )}

                        {/* Assets Section */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                                <h3 className="font-bold text-slate-900 border-l-4 border-emerald-500 pl-3">Aset (Harta)</h3>
                            </div>
                            <div className="p-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-600">Total Aset</span>
                                    <span className="font-bold text-emerald-600">{formatCurrency(data.assets)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Liabilities Section */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                                <h3 className="font-bold text-slate-900 border-l-4 border-rose-500 pl-3">Kewajiban (Utang)</h3>
                            </div>
                            <div className="p-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-600">Total Kewajiban</span>
                                    <span className="font-bold text-rose-600">{formatCurrency(data.liabilities)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Equity Section */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                                <h3 className="font-bold text-slate-900 border-l-4 border-blue-500 pl-3">Ekuitas (Modal)</h3>
                            </div>
                            <div className="divide-y divide-slate-50">
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <span className="text-sm text-slate-600">Modal Awal & Ditahan</span>
                                    <span className="font-bold text-slate-900">{formatCurrency(data.equity?.initial)}</span>
                                </div>
                                <div className="p-4 flex justify-between items-center hover:bg-slate-50">
                                    <span className="text-sm text-slate-600">Laba Tahun Berjalan</span>
                                    <span className="font-bold text-emerald-600">{formatCurrency(data.equity?.current_earnings)}</span>
                                </div>
                                <div className="p-4 flex justify-between items-center bg-slate-50/50">
                                    <span className="text-sm font-bold text-slate-800">Total Ekuitas</span>
                                    <span className="font-bold text-blue-600">{formatCurrency(data.equity?.total)}</span>
                                </div>
                            </div>
                        </div>

                    </div>
                ) : null}
            </div>
        </div>
    );
}
