'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';

type TaxSummaryData = {
    period: { startDate: string; endDate: string };
    ppn: {
        output: number;
        input: number;
        payable: number;
    };
    pph_final_non_pkp: {
        omzet: number;
        amount: number;
    };
};

export default function TaxSummaryPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const nowDate = today.toISOString().slice(0, 10);

    const [startDate, setStartDate] = useState(firstDay);
    const [endDate, setEndDate] = useState(nowDate);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<TaxSummaryData | null>(null);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getTaxSummary({ startDate, endDate });
            setData(res.data);
        } catch (error) {
            console.error('Failed to load tax summary', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (allowed) load();
    }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!allowed) return null;

    return (
        <div className="p-5 md:p-8 space-y-4 bg-slate-50 min-h-screen">
            <div className="flex items-center gap-2">
                <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                    <ArrowLeft size={20} />
                </Link>
                <h1 className="text-xl font-black text-slate-900">Tax Summary</h1>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-4 grid md:grid-cols-3 gap-3 items-end">
                <div>
                    <label className="text-xs font-bold text-slate-500">Start Date</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-500">End Date</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </div>
                <button onClick={load} className="bg-slate-900 text-white rounded-xl px-4 py-2.5 text-sm font-bold">
                    Terapkan
                </button>
            </div>

            {loading ? (
                <div className="h-32 bg-slate-200 animate-pulse rounded-2xl" />
            ) : (
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-2xl border border-slate-100 p-5">
                        <p className="text-xs font-bold text-slate-500 mb-2">PPN</p>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span>PPN Keluaran</span><span className="font-bold">{formatCurrency(Number(data?.ppn?.output || 0))}</span></div>
                            <div className="flex justify-between"><span>PPN Masukan</span><span className="font-bold">{formatCurrency(Number(data?.ppn?.input || 0))}</span></div>
                            <div className="border-t pt-2 flex justify-between"><span>PPN Netto</span><span className="font-black">{formatCurrency(Number(data?.ppn?.payable || 0))}</span></div>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-5">
                        <p className="text-xs font-bold text-slate-500 mb-2">PPh Final (non-PKP)</p>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span>Omzet</span><span className="font-bold">{formatCurrency(Number(data?.pph_final_non_pkp?.omzet || 0))}</span></div>
                            <div className="border-t pt-2 flex justify-between"><span>PPh Final</span><span className="font-black">{formatCurrency(Number(data?.pph_final_non_pkp?.amount || 0))}</span></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
