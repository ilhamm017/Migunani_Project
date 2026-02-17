'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function APAgingPage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getAPAging();
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
            <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40 mb-4">
                <div className="flex items-center gap-3">
                    <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <ArrowLeft size={20} className="text-slate-700" />
                    </Link>
                    <h1 className="font-bold text-lg text-slate-900">Aging Hutang (AP)</h1>
                </div>
            </div>

            <div className="px-5 space-y-4">
                {loading ? (
                    <div className="text-center py-10 text-slate-400">Loading...</div>
                ) : data ? (
                    <>
                        {/* Summary Card */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Hutang Supplier</p>
                            <p className="text-3xl font-black text-slate-900">
                                {formatCurrency(data.summary.total)}
                            </p>

                            <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-slate-100">
                                <div className="text-center">
                                    <p className="text-[10px] text-slate-400 mb-1">0-30</p>
                                    <p className="text-xs font-bold text-slate-700">{formatCurrency(data.summary['0-30'])}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-[10px] text-slate-400 mb-1">31-60</p>
                                    <p className="text-xs font-bold text-amber-600">{formatCurrency(data.summary['31-60'])}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-[10px] text-slate-400 mb-1">61-90</p>
                                    <p className="text-xs font-bold text-orange-600">{formatCurrency(data.summary['61-90'])}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-[10px] text-slate-400 mb-1">&gt;90</p>
                                    <p className="text-xs font-bold text-rose-600">{formatCurrency(data.summary['>90'])}</p>
                                </div>
                            </div>
                        </div>

                        {/* Detail List */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3 ml-1">Rincian Invoice Supplier</h3>
                            <div className="space-y-3">
                                {data.details?.map((item: any) => (
                                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-bold text-slate-900 text-sm">Supplier #{item.supplier_id}</h4>
                                                <p className="text-xs text-slate-500 font-mono">{item.invoice_number}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-slate-900 text-sm">{formatCurrency(item.total)}</p>
                                                <p className="text-[10px] text-slate-400">Jatuh Tempo: {new Date(item.due_date).toLocaleDateString()}</p>
                                            </div>
                                        </div>

                                        <div className="mt-2 flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overdue</span>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${item.days_overdue > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                {item.days_overdue > 0 ? `${item.days_overdue} Hari` : 'Belum Jatuh Tempo'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
