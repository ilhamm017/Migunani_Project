
'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Truck, ChevronRight } from 'lucide-react';

export default function CodDriverListPage() {
    const router = useRouter();

    // Mock Data
    const drivers = [
        { id: '1', name: 'Budi Santoso', pendingAmount: 1250000, invoiceCount: 5 },
        { id: '2', name: 'Asep Saepul', pendingAmount: 450000, invoiceCount: 2 },
        { id: '3', name: 'Joko Anwar', pendingAmount: 0, invoiceCount: 0 },
    ];

    const formatRp = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <Link href="/finance" className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">Setoran COD</h1>
                    <p className="text-xs text-slate-500">Pilih driver untuk terima setoran</p>
                </div>
            </div>

            <div className="p-4 space-y-3">
                <div className="space-y-3">
                    {drivers.filter(d => d.pendingAmount > 0).map((driver) => (
                        <div
                            key={driver.id}
                            onClick={() => router.push(`/finance/cod/${driver.id}`)}
                            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm active:scale-[0.98] transition-transform flex items-center justify-between cursor-pointer hover:shadow-md"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                                    <Truck size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900">{driver.name}</h3>
                                    <p className="text-xs text-slate-500">{driver.invoiceCount} Invoice menumpuk</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-bold font-mono text-slate-900">{formatRp(driver.pendingAmount)}</p>
                                <div className="text-xs text-orange-600 font-medium mt-1 inline-flex items-center">
                                    Setor Sekarang <ChevronRight size={14} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {drivers.filter(d => d.pendingAmount === 0).length > 0 && (
                    <div className="mt-8">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Driver Sudah Setor / Kosong</h3>
                        <div className="space-y-2 opacity-60">
                            {drivers.filter(d => d.pendingAmount === 0).map(driver => (
                                <div key={driver.id} className="bg-white p-3 rounded-lg border border-slate-200 flex justify-between items-center">
                                    <span className="text-sm font-medium text-slate-600">{driver.name}</span>
                                    <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                        Lunas
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
