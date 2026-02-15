
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet, Building2, Plus, Filter, Calendar } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AccountSelector } from '@/components/finance/AccountSelector';
import { MoneyInput } from '@/components/finance/MoneyInput';

export default function ExpensesPage() {
    const [activeTab, setActiveTab] = useState<'requested' | 'approved' | 'paid'>('requested');
    const [isPayMode, setIsPayMode] = useState(false);
    const [selectedExpense, setSelectedExpense] = useState<any>(null);
    const [payAccount, setPayAccount] = useState('1101'); // Kas

    // Mock Data
    const expenses = [
        { id: 1, category: 'Uang Bensin', amount: 50000, status: 'requested', requester: 'Joko', date: '16 Feb 2024' },
        { id: 2, category: 'Makan Siang', amount: 35000, status: 'requested', requester: 'Asep', date: '16 Feb 2024' },
        { id: 3, category: 'Beli ATK', amount: 120000, status: 'approved', requester: 'Admin', date: '15 Feb 2024' },
        { id: 4, category: 'Service AC', amount: 450000, status: 'paid', requester: 'Boss', date: '10 Feb 2024' },
    ];

    const filteredExpenses = expenses.filter(e => e.status === activeTab);

    const formatRp = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    const handlePay = () => {
        if (!selectedExpense) return;
        // API Call
        alert(`Expense Paid from ${payAccount}`);
        setIsPayMode(false);
        setSelectedExpense(null);
    };

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/finance" className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="font-bold text-slate-900">Pengeluaran</h1>
                        <p className="text-xs text-slate-500">Kelola Biaya Operasional</p>
                    </div>
                </div>
                <button className="bg-slate-900 text-white p-2 rounded-full hover:bg-slate-700">
                    <Plus size={20} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-white border-b border-slate-200 overflow-x-auto hide-scrollbar">
                {['requested', 'approved', 'paid'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={cn(
                            "flex-1 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                            activeTab === tab
                                ? "border-blue-600 text-blue-600"
                                : "border-transparent text-slate-500 hover:text-slate-700"
                        )}
                    >
                        {tab === 'requested' ? 'Perlu Persetujuan' : tab === 'approved' ? 'Siap Bayar' : 'Riwayat'}
                        {tab === 'requested' && expenses.filter(e => e.status === 'requested').length > 0 && (
                            <span className="ml-2 bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[10px]">{expenses.filter(e => e.status === 'requested').length}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
                {filteredExpenses.map((expense) => (
                    <div key={expense.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="font-bold text-slate-800">{expense.category}</h3>
                                <p className="text-xs text-slate-500">Oleh: {expense.requester} • {expense.date}</p>
                            </div>
                            <span className="font-mono font-bold text-slate-900">{formatRp(expense.amount)}</span>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-dashed border-slate-100">
                            {expense.status === 'requested' && (
                                <>
                                    <button className="px-3 py-1.5 text-xs text-red-600 font-medium rounded-lg hover:bg-red-50">Tolak</button>
                                    <button className="px-3 py-1.5 text-xs bg-blue-600 text-white font-medium rounded-lg shadow-sm shadow-blue-200 hover:bg-blue-700">Setujui</button>
                                </>
                            )}
                            {expense.status === 'approved' && (
                                <button
                                    onClick={() => { setSelectedExpense(expense); setIsPayMode(true); }}
                                    className="w-full py-2 text-sm bg-emerald-600 text-white font-bold rounded-lg shadow-sm shadow-emerald-200 hover:bg-emerald-700 flex items-center justify-center gap-2"
                                >
                                    <Wallet size={16} /> Bayar Sekarang
                                </button>
                            )}
                            {expense.status === 'paid' && (
                                <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium bg-emerald-50 px-2 py-1 rounded">
                                    <Building2 size={12} /> Lunas
                                </span>
                            )}
                        </div>
                    </div>
                ))}

                {filteredExpenses.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <Filter size={48} className="mb-2 opacity-50" />
                        <p className="text-sm">Tidak ada data di tab ini</p>
                    </div>
                )}
            </div>

            {/* Payment Bottom Sheet (Mock) */}
            {isPayMode && selectedExpense && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in">
                    <div className="bg-white w-full max-w-md rounded-t-2xl p-5 animate-in slide-in-from-bottom duration-300">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg">Bayar Pengeluaran</h3>
                            <button onClick={() => setIsPayMode(false)} className="text-slate-400 p-2">Tutup</button>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
                            <p className="text-xs text-slate-500 mb-1">Akan dibayar:</p>
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-slate-800">{selectedExpense.category}</span>
                                <span className="font-mono font-bold text-lg">{formatRp(selectedExpense.amount)}</span>
                            </div>
                        </div>

                        <AccountSelector
                            value={payAccount}
                            onChange={setPayAccount}
                            label="Sumber Dana Pembayaran"
                        />

                        <button
                            onClick={handlePay}
                            className="w-full mt-6 bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-200 active:scale-[0.98] transition-transform"
                        >
                            Konfirmasi Bayar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
