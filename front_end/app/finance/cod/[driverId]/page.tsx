
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, Calculator, AlertTriangle, ChevronRight } from 'lucide-react';
import { MoneyInput } from '@/components/finance/MoneyInput';
import { AccountSelector } from '@/components/finance/AccountSelector';
// import { api } from '@/lib/api';

export default function CodSettlementPage() {
    const params = useParams();
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
    const [receivedAmount, setReceivedAmount] = useState(0);
    const [targetAccount, setTargetAccount] = useState('1101'); // Default Kas
    const [note, setNote] = useState('');

    // Mock Data
    const driverName = "Budi Santoso";
    const invoices = [
        { id: '1', number: 'INV-001', customer: 'Bengkel A', amount: 500000 },
        { id: '2', number: 'INV-002', customer: 'Bengkel B', amount: 750000 },
        { id: '3', number: 'INV-005', customer: 'Toko C', amount: 250000 },
    ];

    // Auto-select all on mount
    useEffect(() => {
        setSelectedInvoices(invoices.map(i => i.id));
    }, []);

    const totalExpected = invoices
        .filter(inv => selectedInvoices.includes(inv.id))
        .reduce((sum, inv) => sum + inv.amount, 0);

    const diff = receivedAmount - totalExpected;
    const isShortage = diff < 0;
    const isSurplus = diff > 0;

    const handleNext = () => {
        if (step === 1 && selectedInvoices.length === 0) return alert('Pilih minimal satu invoice');
        if (step === 2 && receivedAmount <= 0) return alert('Masukkan jumlah uang yang diterima');
        setStep(step + 1);
    };

    const handleSubmit = async () => {
        if (isShortage && !note) return alert('Wajib isi catatan untuk selisih kurang!');

        // await api.admin.finance.verifyDriverCod({...})
        alert(`Settlement Berhasil! Masuk ke akun ${targetAccount}. Selisih: ${diff}`);
        router.push('/finance/cod');
    };

    const formatRp = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="bg-slate-50 min-h-screen pb-24 flex flex-col">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <button onClick={() => step > 1 ? setStep(step - 1) : router.back()} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">Terima Setoran</h1>
                    <p className="text-xs text-slate-500">Driver: {driverName} • Langkah {step}/3</p>
                </div>
            </div>

            <div className="flex-1 p-4">
                {/* STEP 1: SELECT INVOICES */}
                {step === 1 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex gap-3 items-start">
                            <CheckCircle size={18} className="text-blue-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-800">Cek fisik invoice yang diserahkan driver. Centang yang ada saja.</p>
                        </div>

                        <div className="space-y-2">
                            {invoices.map(inv => (
                                <label
                                    key={inv.id}
                                    className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${selectedInvoices.includes(inv.id) ? 'bg-white border-blue-500 shadow-sm ring-1 ring-blue-500' : 'bg-slate-50 border-slate-200'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            checked={selectedInvoices.includes(inv.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedInvoices([...selectedInvoices, inv.id]);
                                                else setSelectedInvoices(selectedInvoices.filter(id => id !== inv.id));
                                            }}
                                        />
                                        <div>
                                            <p className="font-bold text-slate-900">{inv.number}</p>
                                            <p className="text-xs text-slate-500">{inv.customer}</p>
                                        </div>
                                    </div>
                                    <span className="font-mono font-medium">{formatRp(inv.amount)}</span>
                                </label>
                            ))}
                        </div>

                        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 flex justify-between items-center z-20 md:static md:bg-transparent md:border-0 md:p-0 md:mt-4">
                            <div>
                                <p className="text-xs text-slate-500">Total Tagihan</p>
                                <p className="text-xl font-bold font-mono">{formatRp(totalExpected)}</p>
                            </div>
                            <button
                                onClick={handleNext}
                                disabled={selectedInvoices.length === 0}
                                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                Lanjut <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 2: INPUT MONEY */}
                {step === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
                            <p className="text-sm text-slate-500 mb-1">Total Tagihan (Expected)</p>
                            <p className="text-3xl font-bold font-mono text-slate-900">{formatRp(totalExpected)}</p>
                        </div>

                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <MoneyInput
                                label="Uang Fisik Diterima"
                                value={receivedAmount}
                                onValueChange={setReceivedAmount}
                                autoFocus
                            />
                        </div>

                        {receivedAmount > 0 && (
                            <div className={`p-4 rounded-xl border flex items-start gap-3 ${isShortage ? 'bg-red-50 border-red-200' : isSurplus ? 'bg-yellow-50 border-yellow-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                {isShortage ? <AlertTriangle className="text-red-500 shrink-0" /> : <CheckCircle className="text-emerald-500 shrink-0" />}
                                <div>
                                    <p className={`font-bold ${isShortage ? 'text-red-700' : isSurplus ? 'text-yellow-700' : 'text-emerald-700'}`}>
                                        {isShortage ? 'KURANG SETOR (SHORTAGE)' : isSurplus ? 'LEBIH SETOR (SURPLUS)' : 'PAS / SESUAI'}
                                    </p>
                                    <p className={`text-lg font-mono font-bold ${isShortage ? 'text-red-600' : isSurplus ? 'text-yellow-600' : 'text-emerald-600'}`}>
                                        {isShortage ? '-' : '+'}{formatRp(Math.abs(diff))}
                                    </p>
                                    {isShortage && <p className="text-xs text-red-600 mt-1">Selisih akan dicatat sebagai <b>Piutang Driver</b>.</p>}
                                    {isSurplus && <p className="text-xs text-yellow-600 mt-1">Kelebihan akan dicatat sebagai <b>Hutang ke Driver</b>.</p>}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleNext}
                            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg mt-4"
                        >
                            Lanjut Konfirmasi
                        </button>
                    </div>
                )}

                {/* STEP 3: CONFIRM & SUBMIT */}
                {step === 3 && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                        <div className="bg-slate-900 text-white p-5 rounded-xl">
                            <div className="flex justify-between mb-2 opacity-70 text-sm">
                                <span>Total Tagihan</span>
                                <span>{formatRp(totalExpected)}</span>
                            </div>
                            <div className="flex justify-between mb-4 opacity-70 text-sm">
                                <span>Uang Diterima</span>
                                <span>{formatRp(receivedAmount)}</span>
                            </div>
                            <div className="h-px bg-slate-700 mb-4" />
                            <div className="flex justify-between items-end">
                                <span className={diff < 0 ? 'text-red-400 font-bold' : diff > 0 ? 'text-yellow-400 font-bold' : 'text-emerald-400 font-bold'}>
                                    {diff < 0 ? 'Kurang (Piutang)' : diff > 0 ? 'Lebih (Simpanan)' : 'Balance'}
                                </span>
                                <span className="text-2xl font-mono font-bold">{formatRp(Math.abs(diff))}</span>
                            </div>
                        </div>

                        <AccountSelector
                            value={targetAccount}
                            onChange={setTargetAccount}
                            label="Simpan Uang Ke:"
                        />

                        {diff !== 0 && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Catatan Selisih (Wajib)</label>
                                <textarea
                                    className="w-full p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500"
                                    rows={2}
                                    placeholder="Contoh: Uang kembalian kurang, driver tombok nanti..."
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                />
                            </div>
                        )}

                        <button
                            onClick={handleSubmit}
                            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold text-lg shadow-lg shadow-emerald-200 mt-4 flex items-center justify-center gap-2"
                        >
                            <CheckCircle size={20} /> Konfirmasi Setoran
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
