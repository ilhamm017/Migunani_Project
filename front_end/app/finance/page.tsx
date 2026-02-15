
'use client';

import React, { useEffect, useState } from 'react';
import { KpiCard } from '@/components/finance/KpiCard';
import { TaskBlock } from '@/components/finance/TaskBlock';
import { InvoiceCard } from '@/components/finance/InvoiceCard';
import { ArrowUpRight, ArrowDownLeft, Truck, AlertCircle, RefreshCw, Wallet, Building2 } from 'lucide-react';
import Link from 'next/link';

// Mock Data for Initial Skeletons (Will replace with API calls)
const MOCK_KPI = {
    kas: { value: 15400000, trend: 'up', trendVal: '+2.5%' },
    bank: { value: 45200000, trend: 'neutral', trendVal: '0%' },
    cod_pending: { value: 3200000, count: 5 },
    transfer_pending: { value: 1250000, count: 3 },
    expense_pending: { count: 2 }
};

export default function FinanceDashboard() {
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Simulate loading
        setTimeout(() => setIsLoading(false), 800);
    }, []);

    const formatRp = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="pb-24 bg-slate-50 min-h-screen">
            {/* Header */}
            <div className="bg-white px-6 py-4 border-b border-slate-200 sticky top-0 z-10">
                <h1 className="text-xl font-bold text-slate-900">Finance Dashboard</h1>
                <p className="text-xs text-slate-500">Selamat bekerja, Admin Finance.</p>
            </div>

            {/* KPI Row - Horizontal Scroll */}
            <div className="flex gap-3 overflow-x-auto px-6 py-4 pb-2 snap-x hide-scrollbar">
                <KpiCard
                    title="Saldo Kas Tunai"
                    value={formatRp(MOCK_KPI.kas.value)}
                    subValue="Update: Baru saja"
                    icon={<Wallet size={18} className="text-emerald-600" />}
                    color="green"
                    className="snap-start min-w-[240px]"
                />
                <KpiCard
                    title="Saldo Bank BCA"
                    value={formatRp(MOCK_KPI.bank.value)}
                    subValue="Update: 10 menit lalu"
                    icon={<Building2 size={18} className="text-blue-600" />}
                    color="blue"
                    className="snap-start min-w-[240px]"
                />
                <KpiCard
                    title="COD Belum Setor"
                    value={formatRp(MOCK_KPI.cod_pending.value)}
                    subValue={`${MOCK_KPI.cod_pending.count} Driver Pending`}
                    icon={<Truck size={18} className="text-orange-600" />}
                    color="yellow"
                    className="snap-start min-w-[200px]"
                    onClick={() => window.location.href = '/finance/cod'}
                />
                <KpiCard
                    title="Transfer Pending"
                    value={formatRp(MOCK_KPI.transfer_pending.value)}
                    subValue={`${MOCK_KPI.transfer_pending.count} Bukti Baru`}
                    icon={<RefreshCw size={18} className="text-purple-600" />}
                    color="default"
                    className="snap-start min-w-[200px]"
                    onClick={() => window.location.href = '/finance/transfers'}
                />
            </div>

            {/* Task Queue Section */}
            <div className="px-6 py-4 space-y-4">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Antrian Prioritas</h2>

                {/* 1. Transfer Verification Block */}
                <TaskBlock
                    title="Verifikasi Transfer"
                    count={3}
                    href="/finance/transfers"
                    actionLabel="Lihat Semua (3)"
                    onAction={() => { }}
                >
                    <div className="space-y-3">
                        {/* Only show top item */}
                        <InvoiceCard
                            title="Bengkel Maju Jaya" // Customer name
                            subtitle="INV-20240216-001"
                            amount={450000}
                            amountPaid={0}
                            status="pending"
                            date="16 Feb 2024 • 10:30"
                            onClick={() => { }} // Go to detail
                        />
                    </div>
                </TaskBlock>

                {/* 2. COD Settlement Block */}
                <TaskBlock
                    title="Setoran COD Driver"
                    count={5}
                    href="/finance/cod"
                    actionLabel="Lihat Semua Driver"
                    onAction={() => { }}
                >
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                                B
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm">Budi Santoso</h4>
                                <p className="text-xs text-slate-500">Membawa Rp {(1200000).toLocaleString('id-ID')}</p>
                            </div>
                        </div>
                        <button className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-md font-medium">
                            Terima
                        </button>
                    </div>
                </TaskBlock>

                {/* 3. Expense Approval Block */}
                <TaskBlock
                    title="Pengajuan Biaya"
                    count={2}
                    href="/finance/expenses"
                    actionLabel="Buka Halaman Expense"
                    onAction={() => { }}
                >
                    <div className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-slate-600 uppercase">Uang Bensin</span>
                            <span className="text-[10px] bg-yellow-100 text-yellow-800 px-1.5 rounded">REQUESTED</span>
                        </div>
                        <h4 className="text-lg font-mono font-bold">Rp 50.000</h4>
                        <p className="text-xs text-slate-400 mt-1">Diajukan oleh: Joko (Driver)</p>

                        <div className="grid grid-cols-2 gap-2 mt-3">
                            <button className="text-xs font-medium py-1.5 rounded bg-slate-100 text-slate-600">Tolak</button>
                            <button className="text-xs font-medium py-1.5 rounded bg-blue-600 text-white">Approve</button>
                        </div>
                    </div>
                </TaskBlock>
            </div>
        </div>
    );
}
