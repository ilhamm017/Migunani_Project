
'use client';
import React from 'react';
import { InvoiceCard } from '@/components/finance/InvoiceCard';
import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function TransferListPage() {
    const router = useRouter();

    // Mock Data
    const transfers = [
        { id: '1', customer: 'Bengkel Maju Jaya', invoice: 'INV-001', amount: 450000, date: '16 Feb 2024' },
        { id: '2', customer: 'Toko Sparepart Abadi', invoice: 'INV-002', amount: 1250000, date: '16 Feb 2024' },
        { id: '3', customer: 'User Umum (Guest)', invoice: 'INV-003', amount: 75000, date: '15 Feb 2024' },
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <Link href="/finance" className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">Verifikasi Transfer</h1>
                    <p className="text-xs text-slate-500">3 Menunggu Konfirmasi</p>
                </div>
            </div>

            {/* Search */}
            <div className="px-4 py-3 bg-white border-b border-slate-100">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Cari invoice atau nama customer..."
                        className="w-full pl-9 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                </div>
            </div>

            {/* List */}
            <div className="p-4 space-y-3">
                {transfers.map((item) => (
                    <InvoiceCard
                        key={item.id}
                        title={item.customer}
                        subtitle={item.invoice}
                        amount={item.amount}
                        status="pending"
                        date={item.date}
                        onClick={() => router.push(`/finance/transfers/${item.id}`)}
                    />
                ))}
            </div>
        </div>
    );
}
