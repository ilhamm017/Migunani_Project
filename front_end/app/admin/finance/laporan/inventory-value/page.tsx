'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft, Package } from 'lucide-react';
import Link from 'next/link';

export default function InventoryValuePage() {
    const allowed = useRequireRoles(['super_admin', 'admin_finance']);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        try {
            setLoading(true);
            const res = await api.admin.finance.getInventoryValue();
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
                    <h1 className="font-bold text-lg text-slate-900">Nilai Inventaris</h1>
                </div>
            </div>

            <div className="px-5 space-y-4">
                {loading ? (
                    <div className="text-center py-10 text-slate-400">Loading...</div>
                ) : data ? (
                    <>
                        {/* Summary Card */}
                        <div className="bg-purple-600 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden">
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-2 opacity-80">
                                    <Package size={20} />
                                    <span className="text-xs font-bold uppercase tracking-wider">Total Aset Gudang</span>
                                </div>
                                <p className="text-3xl font-black mb-4">{formatCurrency(data.total_valuation)}</p>
                                <div className="text-sm font-medium bg-white/10 inline-block px-3 py-1 rounded-lg">
                                    {data.total_items} unit barang
                                </div>
                            </div>
                        </div>

                        {/* Breakdown List */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3 ml-1">Rincian Barang</h3>
                            <div className="space-y-3">
                                {data.breakdown?.map((item: any) => (
                                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-bold text-slate-900 text-sm">{item.name}</h4>
                                                <p className="text-xs text-slate-500 font-mono">{item.sku}</p>
                                            </div>
                                            <span className="font-bold text-purple-600 text-sm">
                                                {formatCurrency(item.total_valuation)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs text-slate-400 bg-slate-50 p-2 rounded-lg">
                                            <span>Stok: <b className="text-slate-700">{item.stock_quantity}</b></span>
                                            <span>HPP: <b className="text-slate-700">{formatCurrency(item.base_price)}</b></span>
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
