
'use client';
import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { AccountSelector } from '@/components/finance/AccountSelector';
import Image from 'next/image';

export default function TransferDetailPage() {
    const params = useParams();
    const router = useRouter();
    const [selectedAccount, setSelectedAccount] = useState('1102'); // Default Bank
    const [isRejectionMode, setIsRejectionMode] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    // Mock Data
    const data = {
        invoice: 'INV-001',
        amount: 450000,
        customer: 'Bengkel Maju Jaya',
        date: '16 Feb 2024 10:30',
        items: [
            { name: 'Oli Mesin X', qty: 10, price: 45000 }
        ],
        proofUrl: 'https://placehold.co/400x600/png?text=Bukti+Transfer'
    };

    const handleApprove = () => {
        if (!confirm('Yakin verifikasi pembayaran ini? Jurnal akan otomatis dibuat.')) return;
        // API Call here
        alert(`Approved to Account ${selectedAccount}`);
        router.push('/finance/transfers');
    };

    const handleReject = () => {
        if (!rejectReason) return alert('Wajib isi alasan penolakan!');
        // API Call here
        alert(`Rejected: ${rejectReason}`);
        router.push('/finance/transfers');
    };

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">{data.invoice}</h1>
                    <p className="text-xs text-slate-500">{data.customer}</p>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* 1. Payment Proof */}
                <div className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                    <div className="p-3 bg-slate-50 border-b border-slate-100 font-medium text-sm text-slate-600">
                        Bukti Transfer
                    </div>
                    <div className="relative aspect-[4/3] bg-slate-100">
                        <Image
                            src={data.proofUrl}
                            alt="Bukti Transfer"
                            fill
                            className="object-contain" // Contain to show full receipt
                        />
                    </div>
                    <div className="p-3 text-center">
                        <button className="text-sm text-blue-600 font-medium">Lihat Gambar Full</button>
                    </div>
                </div>

                {/* 2. Invoice Details */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex justify-between items-end mb-4 border-b border-dashed border-slate-200 pb-4">
                        <span className="text-slate-500 text-sm">Total Tagihan</span>
                        <span className="text-2xl font-bold font-mono text-slate-900">
                            Rp {data.amount.toLocaleString('id-ID')}
                        </span>
                    </div>
                    <div className="space-y-2">
                        {data.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="text-slate-600">{item.qty}x {item.name}</span>
                                <span className="font-mono">{item.price.toLocaleString('id-ID')}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Action Area */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-4">
                    {!isRejectionMode ? (
                        <>
                            <AccountSelector
                                value={selectedAccount}
                                onChange={setSelectedAccount}
                                label="Uang Masuk Ke:"
                            />

                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => setIsRejectionMode(true)}
                                    className="flex items-center justify-center gap-2 py-3 rounded-xl border border-red-200 bg-red-50 text-red-600 font-bold hover:bg-red-100 transition-colors"
                                >
                                    <XCircle size={18} /> Tolak
                                </button>
                                <button
                                    onClick={handleApprove}
                                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                                >
                                    <CheckCircle size={18} /> Terima
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                            <label className="text-sm font-medium text-slate-700">Alasan Penolakan</label>
                            <textarea
                                className="w-full p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                rows={3}
                                placeholder="Contoh: Bukti buram, Nominal tidak sesuai..."
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setIsRejectionMode(false)}
                                    className="py-2.5 rounded-lg text-slate-600 font-medium hover:bg-slate-100"
                                >
                                    Batal
                                </button>
                                <button
                                    onClick={handleReject}
                                    className="py-2.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
                                >
                                    Konfirmasi Tolak
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
