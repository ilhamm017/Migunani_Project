
'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, PieChart, TrendingUp, TrendingDown, Calendar, FileText, ChevronRight, Scale } from 'lucide-react';

export default function ReportsPage() {
    const reports = [
        {
            id: 'pnl',
            title: 'Laba Rugi (P&L)',
            desc: 'Income vs Expense',
            icon: TrendingUp,
            color: 'text-emerald-600',
            bg: 'bg-emerald-100'
        },
        {
            id: 'balance_sheet',
            title: 'Neraca Keuangan',
            desc: 'Assets, Liabilities, Equity',
            icon: Scale,
            color: 'text-blue-600',
            bg: 'bg-blue-100'
        },
        {
            id: 'cashflow',
            title: 'Arus Kas',
            desc: 'Cash In & Out',
            icon: TrendingDown,
            color: 'text-orange-600',
            bg: 'bg-orange-100'
        },
        {
            id: 'ap_ar',
            title: 'Hutang & Piutang',
            desc: 'AP / AR Aging',
            icon: FileText,
            color: 'text-purple-600',
            bg: 'bg-purple-100'
        }
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <Link href="/finance" className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">Laporan Keuangan</h1>
                    <p className="text-xs text-slate-500">Real-time Financial Snapshot</p>
                </div>
                <button className="bg-slate-100 p-2 rounded-lg text-slate-600">
                    <Calendar size={20} />
                </button>
            </div>

            <div className="p-4 space-y-4">
                {/* Snapshot Card */}
                <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xl shadow-slate-200">
                    <p className="text-xs opacity-70 mb-1">Profit Bulan Ini (Estimasi)</p>
                    <h2 className="text-3xl font-bold font-mono">Rp 12.500.000</h2>
                    <div className="flex gap-4 mt-4">
                        <div className="flex-1 bg-white/10 rounded-lg p-2.5">
                            <p className="text-[10px] opacity-70">Revenue</p>
                            <p className="font-bold text-emerald-400 text-sm font-mono">+45.2 jt</p>
                        </div>
                        <div className="flex-1 bg-white/10 rounded-lg p-2.5">
                            <p className="text-[10px] opacity-70">Expense</p>
                            <p className="font-bold text-red-400 text-sm font-mono">-32.7 jt</p>
                        </div>
                    </div>
                </div>

                {/* Report Grid */}
                <div className="grid grid-cols-1 gap-3">
                    {reports.map((report) => (
                        <Link
                            href={`/finance/reports/${report.id}`}
                            key={report.id}
                            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-all active:scale-[0.99]"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-full ${report.bg} ${report.color} flex items-center justify-center`}>
                                    <report.icon size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900">{report.title}</h3>
                                    <p className="text-xs text-slate-500">{report.desc}</p>
                                </div>
                            </div>
                            <ChevronRight className="text-slate-300" />
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
