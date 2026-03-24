'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';

type VatRow = {
    month: number;
    ppn_keluaran: number;
    ppn_masukan: number;
    ppn_netto: number;
};

export default function VatMonthlyPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [year, setYear] = useState<number>(new Date().getFullYear());
    const [rows, setRows] = useState<VatRow[]>([]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getVatMonthly({ year });
            setRows(res.data?.rows || []);
        } catch (error) {
            console.error('Failed to load vat monthly report', error);
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
                <h1 className="text-xl font-black text-slate-900">PPN Bulanan</h1>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-4 flex gap-3 items-end">
                <div>
                    <label className="text-xs font-bold text-slate-500">Tahun</label>
                    <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))} className="mt-1 border border-slate-200 rounded-xl px-3 py-2 text-sm w-40" />
                </div>
                <button onClick={load} className="bg-slate-900 text-white rounded-xl px-4 py-2.5 text-sm font-bold">
                    Muat
                </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="grid grid-cols-4 bg-slate-100 px-4 py-3 text-xs font-black text-slate-600 uppercase">
                    <div>Bulan</div>
                    <div className="text-right">PPN Keluaran</div>
                    <div className="text-right">PPN Masukan</div>
                    <div className="text-right">PPN Netto</div>
                </div>
                {loading ? (
                    <div className="p-4 text-sm text-slate-500">Loading...</div>
                ) : rows.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">Belum ada data</div>
                ) : (
                    rows.map((r) => (
                        <div key={r.month} className="grid grid-cols-4 px-4 py-3 text-sm border-t border-slate-100">
                            <div>{r.month}</div>
                            <div className="text-right font-semibold">{formatCurrency(Number(r.ppn_keluaran || 0))}</div>
                            <div className="text-right font-semibold">{formatCurrency(Number(r.ppn_masukan || 0))}</div>
                            <div className="text-right font-black">{formatCurrency(Number(r.ppn_netto || 0))}</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
